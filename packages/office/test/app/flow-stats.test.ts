import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flowStats, formatDuration, formatFlowStats, readEventFile } from "../../src/app/flow-stats";
import type { Clock } from "../../src/kernel";
import { EventLog, InMemoryEventStore, type DomainEvent } from "../../src/kernel/events";

const MINUTE = 60_000;

function openLog() {
  let now = new Date("2026-10-10T12:00:00.000Z");
  const clock: Clock = { now: () => now };
  const log = new EventLog(new InMemoryEventStore(), clock);
  let nextRun = 0;

  const at = async (minute: number, ...events: DomainEvent[]) => {
    now = new Date(Date.parse("2026-10-10T12:00:00.000Z") + minute * MINUTE);
    await log.record(events);
  };
  const order = (type: string, orderId: string, payload: object = {}): DomainEvent => ({ type, payload: { orderId, ...payload } });
  const propose = (orderId: string, title = "Add a flag") => order("orders.proposed", orderId, { spec: { title, objective: "Add the flag to the CLI." } });
  const review = (orderId: string, verdict: string, extra: object = {}) =>
    order("delivery.review_completed", orderId, { round: 1, verdict, summary: "read", findings: [], ...extra });
  const checks = (orderId: string, state: string) => order("delivery.checks_changed", orderId, { state });
  const run = async (minute: number, minutes: number, payload: object, finish: DomainEvent["payload"] | "fail" | "leave") => {
    const runId = `run_${++nextRun}`;
    await at(minute, { type: "execution.run_requested", payload: { runId, role: "developer", engine: "claude", access: "write", orderId: null, ...payload } }, { type: "execution.run_started", payload: { runId } });
    if (finish === "leave") return;
    await at(
      minute + minutes,
      finish === "fail"
        ? { type: "execution.run_failed", payload: { runId, failure: { kind: "failed", message: "boom" } } }
        : { type: "execution.run_completed", payload: { runId, turns: 1, ...(finish as object) } },
    );
  };
  const stats = async () => flowStats(await log.readAfter(0), "alpha");
  return { at, order, propose, review, checks, run, stats, log };
}

describe("flow stats", () => {
  it("times each stage of a delivered order from the events that open and close it", async () => {
    const { at, order, propose, review, checks, stats } = openLog();
    await at(0, propose("WO-0001"));
    await at(10, order("orders.signed", "WO-0001"));
    await at(12, order("orders.pull_request_opened", "WO-0001", { pullRequest: 7 }), order("delivery.pull_request_opened", "WO-0001", { repo: "o/r", number: 7, url: "u" }));
    await at(13, checks("WO-0001", "pending"));
    await at(15, review("WO-0001", "approved"));
    await at(16, checks("WO-0001", "passing"));
    await at(76, order("orders.delivered", "WO-0001"));
    await at(80, checks("WO-0001", "failing"));

    const { orders, medians } = await stats();

    expect(orders).toMatchObject([{ id: "WO-0001", projectId: "alpha", status: "delivered", signMs: 10 * MINUTE, buildMs: 2 * MINUTE, reviewMs: 4 * MINUTE, mergeMs: 60 * MINUTE, totalMs: 66 * MINUTE }]);
    expect(medians).toEqual({ signMs: 10 * MINUTE, buildMs: 2 * MINUTE, reviewMs: 4 * MINUTE, mergeMs: 60 * MINUTE, totalMs: 66 * MINUTE });
  });

  it("starts the wait for the merge again when a push follows an approval", async () => {
    const { at, order, propose, review, checks, stats } = openLog();
    await at(0, propose("WO-0001"));
    await at(1, order("orders.signed", "WO-0001"));
    await at(2, order("orders.pull_request_opened", "WO-0001", { pullRequest: 7 }), checks("WO-0001", "passing"));
    await at(3, review("WO-0001", "changes_requested"));
    await at(4, order("delivery.follow_up_requested", "WO-0001", { instruction: "fix it" }));
    await at(5, review("WO-0001", "approved"));
    await at(6, order("delivery.pull_request_updated", "WO-0001", { number: 7 }));
    await at(9, review("WO-0001", "approved"), checks("WO-0001", "passing"));
    await at(20, order("orders.delivered", "WO-0001"));

    expect((await stats()).orders).toMatchObject([{ reviewRounds: 3, firstVerdict: "changes_requested", followUps: 1, reviewMs: 7 * MINUTE, mergeMs: 11 * MINUTE }]);
  });

  it("leaves review and merge unknown for an order merged without an approval that read the repository", async () => {
    const { at, order, propose, review, checks, stats } = openLog();
    await at(0, propose("WO-0001"), propose("WO-0002"));
    await at(1, order("orders.signed", "WO-0001"), order("orders.signed", "WO-0002"));
    await at(2, order("orders.pull_request_opened", "WO-0001", { pullRequest: 7 }), order("orders.pull_request_opened", "WO-0002", { pullRequest: 8 }));
    await at(3, checks("WO-0001", "passing"), checks("WO-0002", "passing"), review("WO-0002", "approved", { diffOnly: true }));
    await at(9, order("orders.delivered", "WO-0001"), order("orders.delivered", "WO-0002"));

    const { orders, medians } = await stats();

    expect(orders.map((flow) => [flow.reviewMs, flow.mergeMs, flow.totalMs])).toEqual([[null, null, 8 * MINUTE], [null, null, 8 * MINUTE]]);
    expect(medians).toMatchObject({ reviewMs: null, mergeMs: null, totalMs: 8 * MINUTE });
  });

  it("keeps an order that was never delivered out of the medians, and counts what stopped it", async () => {
    const { at, order, propose, stats } = openLog();
    await at(0, propose("WO-0001"), propose("WO-0002"), propose("WO-0003"));
    await at(4, order("orders.signed", "WO-0001"), order("orders.signed", "WO-0002"));
    await at(5, order("orders.pull_request_opened", "WO-0001", { pullRequest: 7 }));
    await at(6, order("orders.delivered", "WO-0001"));
    await at(7, order("delivery.work_blocked", "WO-0002", { reason: "it touches AGENTS.md, which is protected" }));
    await at(8, order("delivery.work_retried", "WO-0002"));
    await at(9, order("delivery.work_blocked", "WO-0002", { reason: "it touches AGENTS.md, which is protected" }), order("delivery.question_raised", "WO-0002", { question: "which one?" }));
    await at(500, order("orders.discarded", "WO-0003"));
    await at(501, { type: "manager.answer_rejected", payload: { attempt: 1, issues: "too long" } });

    const result = await stats();

    expect(result.medians).toMatchObject({ signMs: 4 * MINUTE, buildMs: MINUTE, totalMs: 2 * MINUTE });
    expect(result.orders.map((flow) => [flow.status, flow.blocks, flow.retries, flow.questions, flow.totalMs])).toEqual([
      ["delivered", 0, 0, 0, 2 * MINUTE],
      ["signed", 2, 1, 1, null],
      ["discarded", 0, 0, 0, null],
    ]);
    expect(result.blockReasons).toEqual([{ reason: "it touches AGENTS.md, which is protected", count: 2 }]);
    expect(result.refusedAnswers).toBe(1);
  });

  it("counts blocks that differ only in the output they quote as one reason", async () => {
    const { at, order, propose, stats } = openLog();
    const failing = (output: string) => order("delivery.work_blocked", "WO-0001", { reason: `verification still fails after 2 rounds: \n${output}` });
    await at(0, propose("WO-0001"));
    await at(1, failing("Error: ENOENT /tmp/a"));
    await at(2, failing("AssertionError: expected 1 to be 2"));

    const report = await stats();

    expect(report.blockReasons).toEqual([{ reason: "verification still fails after 2 rounds:", count: 2 }]);
    expect(formatFlowStats(report)).toMatch(/^Blocks\n  2  verification still fails after 2 rounds:$/m);
  });

  it("groups runs by role, engine and model, and never reads a missing cost as zero", async () => {
    const { run, stats } = openLog();
    const usage = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: null };
    await run(0, 2, { model: "sonnet" }, { costUsd: 0.2, turns: 4, model: "claude-sonnet-5-5", usage });
    await run(10, 4, { model: "sonnet" }, { costUsd: 0.4, turns: 8, model: "claude-sonnet-5-5", usage });
    await run(20, 900, { model: "claude-sonnet-5-5" }, "fail");
    await run(30, 1, { role: "code_reviewer", engine: "codex", access: "read" }, { costUsd: 0, model: "gpt" });
    await run(40, 0, { role: "code_reviewer", engine: "codex", access: "read" }, "leave");

    const { runs, spentUsd } = await stats();

    expect(runs).toEqual([
      { role: "developer", engine: "claude", model: "claude-sonnet-5-5", runs: 3, unfinished: 1, spentUsd: 0.6000000000000001, usage: { inputTokens: 2000, outputTokens: 200, cachedInputTokens: null }, medianMs: 3 * MINUTE, medianTurns: 6 },
      { role: "code_reviewer", engine: "codex", model: "gpt", runs: 2, unfinished: 1, spentUsd: null, usage: null, medianMs: MINUTE, medianTurns: 1 },
    ]);
    expect(spentUsd).toBeCloseTo(0.6);
  });

  it("credits an order to the worker and model of its first writing run, whoever touched it later", async () => {
    const { at, order, propose, review, run, stats } = openLog();
    await at(0, propose("WO-0001"), propose("WO-0002"), propose("WO-0003"));
    await at(1, order("orders.signed", "WO-0001"), order("orders.signed", "WO-0002"), order("orders.signed", "WO-0003"));
    await run(2, 1, { orderId: "WO-0001", role: "manager", access: "read" }, { costUsd: 0.05, model: "haiku" });
    await run(4, 1, { orderId: "WO-0001" }, { costUsd: 0.1, model: "sonnet" });
    await run(6, 1, { orderId: "WO-0001", role: "ana" }, { costUsd: 0.3, model: "opus" });
    await run(8, 1, { orderId: "WO-0002" }, { costUsd: 0.2, model: "sonnet" });
    await run(10, 1, { orderId: "WO-0003", role: "ana", engine: "codex" }, { costUsd: null });
    await at(20, order("orders.pull_request_opened", "WO-0001", { pullRequest: 1 }), order("orders.pull_request_opened", "WO-0002", { pullRequest: 2 }));
    await at(21, review("WO-0001", "approved"), review("WO-0002", "changes_requested"));
    await at(30, order("orders.delivered", "WO-0001"));

    const { authors, orders } = await stats();

    expect(orders.map((flow) => [flow.author, flow.runs, flow.spentUsd])).toEqual([
      ["developer · sonnet", 3, expect.closeTo(0.45)],
      ["developer · sonnet", 1, 0.2],
      ["ana · codex default", 1, null],
    ]);
    expect(authors).toEqual([
      { author: "developer · sonnet", orders: 2, delivered: 1, reviewed: 2, approvedFirst: 1, medianBuildMs: 19 * MINUTE, usdPerOrder: expect.closeTo(0.325) },
      { author: "ana · codex default", orders: 1, delivered: 0, reviewed: 0, approvedFirst: 0, medianBuildMs: null, usdPerOrder: null },
    ]);
  });

  it("does not count a first review made from the diff alone for or against its author", async () => {
    const { at, order, propose, review, run, stats } = openLog();
    await at(0, propose("WO-0001"), propose("WO-0002"), propose("WO-0003"));
    for (const id of ["WO-0001", "WO-0002", "WO-0003"]) await run(1, 1, { orderId: id }, { costUsd: 0.1, model: "sonnet" });
    await at(5, review("WO-0001", "approved", { diffOnly: true }), review("WO-0002", "approved"), review("WO-0003", "changes_requested", { diffOnly: true }));
    await at(6, review("WO-0003", "approved"));

    const report = await stats();

    expect(report.orders.map((flow) => [flow.firstVerdict, flow.firstReviewDiffOnly, flow.reviewRounds, flow.diffOnlyReviews])).toEqual([
      ["approved", true, 1, 1],
      ["approved", false, 1, 0],
      ["changes_requested", true, 2, 1],
    ]);
    expect(report.authors).toMatchObject([{ author: "developer · sonnet", orders: 3, reviewed: 1, approvedFirst: 1 }]);
    const printed = formatFlowStats(report);
    expect(printed).toMatch(/^WO-0001 .* 1, 1 diff only +approved, diff only /m);
    expect(printed).toMatch(/^WO-0002 .* 1 +approved +0 /m);
    expect(printed).toMatch(/^developer · sonnet +3 +0 +1 of 1 /m);
  });

  it("prints unknown times and unreported costs as a dash, never as zero", async () => {
    const { at, order, propose, run, stats } = openLog();
    await at(0, propose("WO-0001", "Add a flag"));
    await at(125, order("orders.signed", "WO-0001"));
    await run(126, 1, { orderId: "WO-0001", engine: "codex" }, { costUsd: null, model: "gpt" });

    const report = formatFlowStats(await stats());

    expect(report).toContain("1 orders, 0 delivered, 0 discarded · - reported");
    expect(report).toMatch(/^WO-0001 +signed +developer · gpt +2h 05m +- +- +- +- +0 +- +0 +0 +0 +0 +1 +-$/m);
    expect(report).toMatch(/^developer +codex +gpt +1 +0 +1m +1 +- +- +-$/m);
    expect(formatFlowStats(flowStats([]))).toBe("The log has no orders and no runs yet.");
    expect([null, 0, 59_400, 59 * MINUTE, 565 * MINUTE].map(formatDuration)).toEqual(["-", "0s", "59s", "59m", "9h 25m"]);
  });
});

describe.each([
  ["an alias in team.yaml", "sonnet"],
  ["no model in team.yaml", undefined],
])("one worker on one model, with %s", (_name, requested) => {
  it("is one author and one row of runs, whether a run finished or not", async () => {
    const { at, propose, run, stats } = openLog();
    const asked = (orderId: string) => ({ orderId, ...(requested && { model: requested }) });
    await at(0, propose("WO-0001"), propose("WO-0002"));
    await run(1, 1, asked("WO-0001"), { costUsd: 0.1, model: "claude-sonnet-5-5" });
    await run(3, 1, asked("WO-0002"), "fail");
    await run(5, 1, asked("WO-0002"), { costUsd: 0.1, model: "claude-sonnet-5-5" });

    const { authors, runs } = await stats();

    expect(runs.map((group) => ({ model: group.model, runs: group.runs, unfinished: group.unfinished }))).toEqual([{ model: "claude-sonnet-5-5", runs: 3, unfinished: 1 }]);
    expect(authors.map((author) => ({ author: author.author, orders: author.orders }))).toEqual([{ author: "developer · claude-sonnet-5-5", orders: 2 }]);
  });
});

describe("a run that never completed, asked for a model its role later changed", () => {
  it("is counted under the model reported nearest before it, not the newest", async () => {
    const { run, stats } = openLog();
    await run(1, 1, { model: "sonnet" }, { costUsd: 0.1, model: "claude-sonnet-5-4" });
    await run(3, 1, { model: "sonnet" }, "fail");
    await run(5, 1, { model: "sonnet" }, { costUsd: 0.1, model: "claude-sonnet-5-5" });
    await run(7, 1, { role: "ana", model: "opus" }, "fail");

    expect((await stats()).runs.map((group) => [group.role, group.model, group.runs, group.unfinished])).toEqual([
      ["developer", "claude-sonnet-5-4", 2, 1],
      ["developer", "claude-sonnet-5-5", 1, 0],
      ["ana", "opus", 1, 1],
    ]);
  });
});

describe("reading the log beside a live office", () => {
  it("skips a last line that is still being written, and leaves the file as it found it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skynot-stats-"));
    const path = join(dir, "events.jsonl");
    const whole = JSON.stringify({ sequence: 1, id: "evt_1", occurredAt: "2026-10-10T12:00:00.000Z", type: "orders.signed", payload: { orderId: "WO-0001" } });
    const content = `${whole}\n{"sequence":2,"id":"evt_2","occ`;
    await writeFile(path, content);

    expect(await readEventFile(path)).toEqual([JSON.parse(whole)]);
    expect(await readFile(path, "utf8")).toBe(content);

    await writeFile(path, `{"broken\n${whole}\n`);
    await expect(readEventFile(path)).rejects.toThrow("line 1 is not valid JSON");
    await rm(dir, { recursive: true });
  });
});
