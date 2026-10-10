import { describe, expect, it } from "vitest";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { closeOrphanedRuns, RunsProjection } from "../../src/execution";
import type { Clock } from "../../src/kernel";

async function openRuns() {
  let now = new Date("2026-10-10T12:00:00.000Z");
  const clock: Clock = { now: () => now };
  const log = new EventLog(new InMemoryEventStore(), clock);
  const runs = new RunsProjection();
  await attachProjection(log, runs);
  let next = 0;
  const finish = async (at: string, orderId: string | null, costUsd: number | null) => {
    now = new Date(at);
    const runId = `run_${++next}`;
    await log.record([{ type: "execution.run_requested", payload: { runId, role: "developer", engine: "claude", access: "read", orderId } }]);
    await log.record(
      costUsd === null
        ? [{ type: "execution.run_failed", payload: { runId, failure: { kind: "failed", message: "boom" } } }]
        : [{ type: "execution.run_completed", payload: { runId, costUsd, turns: 1, model: "m" } }],
    );
  };
  return { runs, finish, log };
}

describe("runs left over by a restart", () => {
  it("closes the queued and running ones as failed and leaves finished runs alone", async () => {
    const { runs, log } = await openRuns();
    const request = (runId: string) => log.record([{ type: "execution.run_requested", payload: { runId, role: "developer", engine: "claude", access: "read", orderId: "WO-0001" } }]);
    await request("run_queued");
    await request("run_running");
    await log.record([{ type: "execution.run_started", payload: { runId: "run_running" } }]);
    await request("run_done");
    await log.record([{ type: "execution.run_completed", payload: { runId: "run_done", costUsd: 0.5, turns: 1, model: "m" } }]);

    expect(await closeOrphanedRuns(runs, log)).toBe(2);

    expect(runs.list().map((run) => [run.id, run.status])).toEqual([["run_queued", "failed"], ["run_running", "failed"], ["run_done", "completed"]]);
    expect(await closeOrphanedRuns(runs, log)).toBe(0);
  });
});

describe("costs", () => {
  it("adds up what each order and each day cost", async () => {
    const { runs, finish } = await openRuns();
    await finish("2026-10-10T23:59:00.000Z", "WO-0001", 0.5);
    await finish("2026-10-11T00:01:00.000Z", "WO-0001", 0.25);
    await finish("2026-10-11T09:00:00.000Z", "WO-0002", 1);
    await finish("2026-10-11T10:00:00.000Z", null, 0.1);

    expect(runs.spentOn("2026-10-10")).toBeCloseTo(0.5);
    expect(runs.spentOn("2026-10-11")).toBeCloseTo(1.35);
    expect(runs.spentOnOrder("WO-0001")).toBeCloseTo(0.75);
    expect(runs.spentOnOrder("WO-0002")).toBeCloseTo(1);
    expect(runs.spentOnOrder("WO-9999")).toBe(0);
    expect(runs.spentTotal()).toBeCloseTo(1.85);
  });

  it("counts what a failed run reports it spent", async () => {
    const { runs, log } = await openRuns();
    await log.record([{ type: "execution.run_requested", payload: { runId: "run_x", role: "developer", engine: "claude", access: "write", orderId: "WO-0001" } }]);
    await log.record([{ type: "execution.run_failed", payload: { runId: "run_x", failure: { kind: "failed", message: "out of budget", costUsd: 3.02 } } }]);

    expect(runs.spentOn("2026-10-10")).toBeCloseTo(3.02);
    expect(runs.spentOnOrder("WO-0001")).toBeCloseTo(3.02);
  });

  it("counts a run that failed or has not finished as free, since its cost is unknown", async () => {
    const { runs, finish } = await openRuns();
    await finish("2026-10-11T09:00:00.000Z", "WO-0001", null);

    expect(runs.spentOn("2026-10-11")).toBe(0);
    expect(runs.spentOnOrder("WO-0001")).toBe(0);
  });
});
