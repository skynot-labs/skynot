import { describe, expect, it, vi } from "vitest";
import { CostGuard } from "../../src/app/cost-guard";
import { RunsProjection, ShopControl } from "../../src/execution";
import type { Clock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";

async function openGuard(maxUsdPerDay: number | undefined) {
  let now = new Date("2026-10-11T09:00:00.000Z");
  const clock: Clock = { now: () => now };
  const log = new EventLog(new InMemoryEventStore(), clock);
  const runs = new RunsProjection();
  const control = new ShopControl(log);
  await attachProjection(log, runs);
  await attachProjection(log, control);
  new CostGuard({ log, runs, control, maxUsdPerDay }).start();
  let next = 0;
  const spend = async (costUsd: number, at = now) => {
    now = at;
    const runId = `run_${++next}`;
    await log.record([{ type: "execution.run_requested", payload: { runId, role: "developer", engine: "claude", access: "read", orderId: null } }]);
    await log.record([{ type: "execution.run_completed", payload: { runId, costUsd, turns: 1, model: "m" } }]);
  };
  return { control, spend };
}

describe("cost guard", () => {
  it("pauses the shop when the day's spending reaches the cap, and says how much", async () => {
    const { control, spend } = await openGuard(1);

    await spend(0.6);
    expect(control.paused()).toBeNull();
    await spend(0.5);

    await vi.waitFor(() => expect(control.paused()?.reason).toBe("the daily cost cap of $1.00 was reached ($1.10 spent)"));
  });

  it("does nothing without a cap", async () => {
    const { control, spend } = await openGuard(undefined);

    await spend(500);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(control.paused()).toBeNull();
  });

  it("leaves the shop running when the director resumes the same day", async () => {
    const { control, spend } = await openGuard(1);
    await spend(1.5);
    await vi.waitFor(() => expect(control.paused()).not.toBeNull());

    await control.resume();
    await spend(0.5);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(control.paused()).toBeNull();
  });

  it("applies the cap again the next day, counting only that day's spending", async () => {
    const { control, spend } = await openGuard(1);
    await spend(1.5);
    await vi.waitFor(() => expect(control.paused()).not.toBeNull());
    await control.resume();

    await spend(0.4, new Date("2026-10-12T09:00:00.000Z"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(control.paused()).toBeNull();

    await spend(0.7, new Date("2026-10-12T10:00:00.000Z"));
    await vi.waitFor(() => expect(control.paused()?.reason).toContain("$1.10 spent"));
  });

  it("does not pause twice for the same overrun", async () => {
    const { control, spend } = await openGuard(1);

    await spend(2);
    await vi.waitFor(() => expect(control.paused()).not.toBeNull());

    await expect(spend(2)).resolves.toBeUndefined();
  });
});
