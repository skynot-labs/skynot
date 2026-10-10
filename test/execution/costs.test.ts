import { describe, expect, it } from "vitest";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { closeOrphanedRuns, outcomeOf, RunsProjection, type TokenUsage } from "../../src/execution";
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
  it("closes the queued and running ones as interrupted and leaves finished runs alone", async () => {
    const { runs, log } = await openRuns();
    const request = (runId: string) => log.record([{ type: "execution.run_requested", payload: { runId, role: "developer", engine: "claude", access: "read", orderId: "WO-0001" } }]);
    await request("run_queued");
    await request("run_running");
    await log.record([{ type: "execution.run_started", payload: { runId: "run_running" } }]);
    await request("run_done");
    await log.record([{ type: "execution.run_completed", payload: { runId: "run_done", costUsd: 0.5, turns: 1, model: "m" } }]);

    expect(await closeOrphanedRuns(runs, log)).toBe(2);

    expect(runs.list().map((run) => [run.id, run.status])).toEqual([["run_queued", "failed"], ["run_running", "failed"], ["run_done", "completed"]]);
    expect(runs.list().map((run) => run.failure?.kind ?? null)).toEqual(["interrupted", "interrupted", null]);
    expect(runs.list().map(outcomeOf)).toEqual(["interrupted", "interrupted", "completed"]);
    expect(await closeOrphanedRuns(runs, log)).toBe(0);
  });
});

async function openHistory() {
  const { runs, log } = await openRuns();
  let next = 0;
  const request = async (role: string, projectId: string) => {
    const runId = `run_${++next}`;
    await log.record([{ type: "execution.run_requested", payload: { runId, role, engine: "claude", access: "read", orderId: null, projectId } }]);
    return runId;
  };
  const complete = async (role: string, projectId: string, costUsd: number, usage?: TokenUsage) => {
    const runId = await request(role, projectId);
    await log.record([{ type: "execution.run_completed", payload: { runId, costUsd, turns: 3, model: "sonnet", ...(usage && { usage }) } }]);
    return runId;
  };
  const fail = async (role: string, projectId: string, kind: string, extra: object = {}) => {
    const runId = await request(role, projectId);
    await log.record([{ type: "execution.run_failed", payload: { runId, failure: { kind, message: "it ended", ...extra } } }]);
    return runId;
  };
  return { runs, log, request, complete, fail };
}

describe("run history", () => {
  it("keeps the turns, model and tokens of a finished run", async () => {
    const { runs, complete, fail } = await openHistory();
    const usage = { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 800 };
    await complete("developer", "alpha", 0.5, usage);
    await fail("developer", "alpha", "failed", { usage });

    expect(runs.list()).toMatchObject([{ turns: 3, model: "sonnet", usage }, { turns: null, model: null, usage }]);
  });

  it("replays events written before runs reported turns, model or tokens", async () => {
    const { runs, log, request } = await openHistory();
    const runId = await request("developer", "alpha");
    await log.record([{ type: "execution.run_completed", payload: { runId, costUsd: 0.5 } }]);
    await log.record([{ type: "execution.run_requested", payload: { runId: "run_old", role: "reviewer", engine: "codex", access: "read", orderId: null } }]);
    await log.record([{ type: "execution.run_failed", payload: { runId: "run_old", failure: { kind: "failed", message: "the shop restarted before this run finished" } } }]);

    expect(runs.list()).toMatchObject([
      { status: "completed", costUsd: 0.5, turns: null, model: null, usage: null },
      { status: "failed", projectId: "default", turns: null, model: null, usage: null },
    ]);
    expect(runs.list().map(outcomeOf)).toEqual(["completed", "failed"]);
    expect(runs.usageByProject("alpha")).toBeNull();
    expect(runs.byRole("alpha")).toEqual([{ role: "developer", runs: 1, spentUsd: 0.5, usage: null, lastOutcome: "completed" }]);
  });

  it("lists a project's finished runs newest first, up to the limit", async () => {
    const { runs, log, request, complete, fail } = await openHistory();
    const slow = await request("architect", "alpha");
    const first = await complete("developer", "alpha", 0.1);
    await complete("developer", "beta", 0.1);
    const second = await fail("reviewer", "alpha", "timeout");
    await request("developer", "alpha");
    await log.record([{ type: "execution.run_completed", payload: { runId: slow, costUsd: 0.2, turns: 1, model: "m" } }]);

    expect(runs.finished("alpha", 10).map((run) => run.id)).toEqual([slow, second, first]);
    expect(runs.finished("alpha", 2).map((run) => run.id)).toEqual([slow, second]);
    expect(runs.finished("alpha", 0)).toEqual([]);
    expect(runs.finished("gamma", 10)).toEqual([]);
  });

  it("adds up a project's tokens over the runs that reported them", async () => {
    const { runs, complete, fail } = await openHistory();
    await complete("developer", "alpha", 0.1, { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 800 });
    await complete("developer", "alpha", 0.1);
    await complete("reviewer", "alpha", 0.1, { inputTokens: 200, outputTokens: 10, cachedInputTokens: null });
    await fail("reviewer", "alpha", "failed", { usage: { inputTokens: 30, outputTokens: 4, cachedInputTokens: 20 } });
    await complete("developer", "beta", 0.1, { inputTokens: 7, outputTokens: 1, cachedInputTokens: null });
    await complete("developer", "gamma", 0.1);

    expect(runs.usageByProject("alpha")).toEqual({ inputTokens: 1230, outputTokens: 64, cachedInputTokens: 820 });
    expect(runs.usageByProject("beta")).toEqual({ inputTokens: 7, outputTokens: 1, cachedInputTokens: null });
    expect(runs.usageByProject("gamma")).toBeNull();
    expect(runs.usageByProject("nowhere")).toBeNull();
  });

  it("sums each role over all its runs and reports how its latest finished run ended", async () => {
    const { runs, log, request, complete, fail } = await openHistory();
    const usage = { inputTokens: 100, outputTokens: 10, cachedInputTokens: 60 };
    await complete("developer", "alpha", 0.5, usage);
    await fail("developer", "alpha", "failed", { costUsd: 0.25, usage });
    await complete("reviewer", "alpha", 0.1);
    await fail("reviewer", "alpha", "cancelled");
    await fail("architect", "alpha", "engine_unavailable");
    await complete("architect", "alpha", 0.3);
    await request("architect", "alpha");
    await request("designer", "alpha");
    await complete("developer", "beta", 9, usage);

    expect(runs.byRole("alpha")).toEqual([
      { role: "developer", runs: 2, spentUsd: 0.75, usage: { inputTokens: 200, outputTokens: 20, cachedInputTokens: 120 }, lastOutcome: "failed" },
      { role: "reviewer", runs: 2, spentUsd: 0.1, usage: null, lastOutcome: "cancelled" },
      { role: "architect", runs: 3, spentUsd: 0.3, usage: null, lastOutcome: "completed" },
      { role: "designer", runs: 1, spentUsd: 0, usage: null, lastOutcome: null },
    ]);

    await closeOrphanedRuns(runs, log);

    expect(runs.byRole("alpha").map((role) => [role.role, role.lastOutcome])).toEqual([
      ["developer", "failed"],
      ["reviewer", "cancelled"],
      ["architect", "interrupted"],
      ["designer", "interrupted"],
    ]);
  });

  it("labels a timeout as failed and a run that has not finished as nothing", async () => {
    const { runs, request, fail } = await openHistory();
    await fail("developer", "alpha", "timeout");
    await request("developer", "alpha");

    expect(runs.list().map(outcomeOf)).toEqual(["failed", null]);
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
