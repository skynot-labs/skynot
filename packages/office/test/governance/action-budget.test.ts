import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../../src/kernel";
import { attachProjection, EventLog, JsonlEventStore } from "../../src/kernel/events";
import { ActionBudget, ActionCounts, type Policy } from "../../src/governance";
import { examplePolicy } from "./fixtures";

class SettableClock implements Clock {
  constructor(public at: string) {}
  now() {
    return new Date(this.at);
  }
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "skynot-budget-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createBudget(policy: Policy, clock: Clock) {
  const log = new EventLog(new JsonlEventStore(path.join(dir, "events.jsonl")), clock);
  const counts = new ActionCounts();
  await attachProjection(log, counts);
  return new ActionBudget(policy, log, counts, clock);
}

const limits = (overrides: Partial<Policy["limits"]>) => {
  const policy = examplePolicy();
  return { ...policy, limits: { ...policy.limits, ...overrides } };
};

describe("action budget", () => {
  it("stops an order at its own daily limit while other orders keep working", async () => {
    const budget = await createBudget(limits({ actions_per_order_per_day: 2 }), new SettableClock("2026-10-09T10:00:00.000Z"));

    expect((await budget.spend("WO-0001")).ok).toBe(true);
    expect((await budget.spend("WO-0001")).ok).toBe(true);
    expect(await budget.spend("WO-0001")).toMatchObject({ ok: false, error: { kind: "action_limit_reached" } });
    expect((await budget.spend("WO-0002")).ok).toBe(true);
  });

  it("stops everything at the daily limit, orders or not", async () => {
    const budget = await createBudget(limits({ actions_per_day: 2 }), new SettableClock("2026-10-09T10:00:00.000Z"));

    await budget.spend(null);
    await budget.spend("WO-0001");

    expect(await budget.spend(null)).toMatchObject({ ok: false, error: { kind: "action_limit_reached" } });
  });

  it("does not let simultaneous requests overshoot the limit", async () => {
    const budget = await createBudget(limits({ actions_per_day: 3 }), new SettableClock("2026-10-09T10:00:00.000Z"));

    const results = await Promise.all(Array.from({ length: 10 }, () => budget.spend(null)));

    expect(results.filter((result) => result.ok)).toHaveLength(3);
  });

  it("starts fresh on a new day", async () => {
    const clock = new SettableClock("2026-10-09T23:59:00.000Z");
    const budget = await createBudget(limits({ actions_per_day: 1 }), clock);

    await budget.spend(null);
    expect((await budget.spend(null)).ok).toBe(false);

    clock.at = "2026-10-10T00:01:00.000Z";
    expect((await budget.spend(null)).ok).toBe(true);
  });

  it("remembers what was spent today after a restart", async () => {
    const clock = new SettableClock("2026-10-09T10:00:00.000Z");
    const policy = limits({ actions_per_day: 2 });

    const before = await createBudget(policy, clock);
    await before.spend(null);
    await before.spend(null);

    const afterRestart = await createBudget(policy, clock);
    expect((await afterRestart.spend(null)).ok).toBe(false);
  });
});
