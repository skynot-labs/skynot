import { describe, expect, it } from "vitest";
import { createAdvisorBench } from "../../src/app/advisor-bench";
import { FakeEngine, RunScheduler, RunsProjection } from "../../src/execution";
import { fixedClock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import type { Team } from "../../src/team";

const team: Team = {
  version: 1,
  roles: { manager: { engine: "claude" }, developer: { engine: "claude" } },
  advisors: {
    architect: { engine: "claude", model: "architect-model", description: "design", soul: "You are the architect." },
    reviewer: { engine: "claude", description: "scope", soul: "You are the reviewer." },
  },
};

async function openBench(engine: FakeEngine, maxParallel = 4, cwd: () => Promise<string> = async () => "/repo/copy") {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-10T12:00:00.000Z")));
  const runs = new RunsProjection();
  await attachProjection(log, runs);
  const scheduler = new RunScheduler({ claude: engine }, log, maxParallel);
  return { bench: createAdvisorBench(scheduler, team, { cwd, timeoutMs: 1000, maxUsd: 2 }), runs };
}

describe("advisor bench", () => {
  it("lists the advisors with their descriptions", async () => {
    const { bench } = await openBench(new FakeEngine());

    expect(bench.roster()).toEqual([
      { name: "architect", description: "design" },
      { name: "reviewer", description: "scope" },
    ]);
  });

  it("runs the advisors at the same time, read-only, each with its own soul and model", async () => {
    let running = 0;
    let peak = 0;
    let release: () => void = () => undefined;
    const bothStarted = new Promise<void>((resolve) => (release = resolve));
    const engine = new FakeEngine(async (request) => {
      peak = Math.max(peak, ++running);
      if (running === 2) release();
      await bothStarted;
      running--;
      return { text: `  answer to: ${request.prompt}  ` };
    });
    const { bench, runs } = await openBench(engine);

    const replies = await bench.consult([
      { role: "architect", question: "Where does it go?" },
      { role: "reviewer", question: "Is it clear?" },
    ]);

    expect(peak).toBe(2);
    expect(replies.map((reply) => [reply.role, reply.result])).toEqual([
      ["architect", { ok: true, value: "answer to: Where does it go?" }],
      ["reviewer", { ok: true, value: "answer to: Is it clear?" }],
    ]);
    const [architect, reviewer] = ["architect", "reviewer"].map((role) => engine.requests.find((request) => request.system?.includes(`You are the ${role}.`))!);
    expect(architect!).toMatchObject({ access: "read", cwd: "/repo/copy", model: "architect-model", maxUsd: 2 });
    expect("model" in reviewer!).toBe(false);
    expect(runs.list().map((run) => [run.role, run.access, run.orderId])).toEqual([
      ["architect", "read", null],
      ["reviewer", "read", null],
    ]);
  });

  it("reports an advisor that fails without losing the others", async () => {
    const engine = new FakeEngine(async (request) =>
      request.system?.includes("architect") ? { kind: "failed" as const, message: "boom" } : { text: "fine" },
    );
    const { bench } = await openBench(engine);

    const replies = await bench.consult([
      { role: "architect", question: "Thoughts?" },
      { role: "reviewer", question: "Thoughts?" },
    ]);

    expect(replies.map((reply) => reply.result)).toEqual([{ ok: false, error: "boom" }, { ok: true, value: "fine" }]);
  });

  it("fails every request when the repository cannot be read, and an unknown advisor on its own", async () => {
    const down = await openBench(new FakeEngine(), 4, async () => Promise.reject(new Error("no network")));
    const unknown = await openBench(new FakeEngine());

    const failed = await down.bench.consult([{ role: "architect", question: "Thoughts?" }]);
    const missing = await unknown.bench.consult([{ role: "oracle", question: "Thoughts?" }]);

    expect(failed[0]?.result).toEqual({ ok: false, error: "could not read the repository: no network" });
    expect(missing[0]?.result).toEqual({ ok: false, error: "there is no advisor oracle" });
  });

  it("cuts an answer that is too long", async () => {
    const { bench } = await openBench(new FakeEngine(async () => ({ text: "x".repeat(10_000) })));

    const [reply] = await bench.consult([{ role: "architect", question: "Thoughts?" }]);

    expect(reply?.result.ok && reply.result.value).toHaveLength(4000);
  });
});
