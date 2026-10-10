import { describe, expect, it } from "vitest";
import { fixedClock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { FakeEngine, RunScheduler, RunsProjection, type EngineRequest, type RunSubmission } from "../../src/execution";

const request: EngineRequest = { prompt: "do it", cwd: "/tmp/work", access: "read", timeoutMs: 1000 };

const submission = (role = "developer", orderId: string | null = null): RunSubmission => ({
  role,
  engine: "claude",
  orderId,
  request,
});

async function createScheduler(engine: FakeEngine | null, maxParallel: number) {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-09T12:00:00.000Z")));
  const runs = new RunsProjection();
  await attachProjection(log, runs);
  return { log, runs, scheduler: new RunScheduler(engine ? { claude: engine } : {}, log, maxParallel) };
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was never met");
}

function gatedEngine() {
  const gates: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const engine = new FakeEngine(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((open) => gates.push(open));
    active--;
    return { text: "done" };
  });
  return { engine, release: () => gates.shift()!(), peak: () => peak };
}

describe("run scheduler", () => {
  it("never runs more than max_parallel at once and starts queued runs as slots free up", async () => {
    const { engine, release, peak } = gatedEngine();
    const { scheduler } = await createScheduler(engine, 2);

    const outcomes = Array.from({ length: 5 }, () => scheduler.submit(submission()));
    await waitFor(() => engine.requests.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(engine.requests).toHaveLength(2);

    release();
    await waitFor(() => engine.requests.length === 3);

    release();
    release();
    await waitFor(() => engine.requests.length === 5);
    release();
    release();

    expect((await Promise.all(outcomes)).every((outcome) => outcome.ok)).toBe(true);
    expect(peak()).toBe(2);
  });

  it("serves the queue in order and tells each waiting run its position", async () => {
    const { engine, release } = gatedEngine();
    const { scheduler, runs } = await createScheduler(engine, 1);

    const outcomes = [scheduler.submit(submission("a")), scheduler.submit(submission("b")), scheduler.submit(submission("c"))];
    await waitFor(() => engine.requests.length === 1 && runs.list().length === 3);

    const [first, second, third] = runs.list();
    expect(first?.status).toBe("running");
    expect([runs.queuePosition(second!.id), runs.queuePosition(third!.id)]).toEqual([1, 2]);
    expect(runs.queuePosition(first!.id)).toBeNull();

    release();
    await waitFor(() => engine.requests.length === 2);
    expect(runs.queuePosition(third!.id)).toBe(1);
    release();
    await waitFor(() => engine.requests.length === 3);
    release();
    await Promise.all(outcomes);

    expect(runs.list().map((run) => [run.role, run.status])).toEqual([["a", "completed"], ["b", "completed"], ["c", "completed"]]);
  });

  it("records requested, started and completed for a successful run, with its cost", async () => {
    const { scheduler, log, runs } = await createScheduler(new FakeEngine(() => ({ text: "hi", costUsd: 0.25 })), 1);

    const outcome = await scheduler.submit(submission("architect", "WO-0001"));

    expect(outcome).toMatchObject({ ok: true, value: { text: "hi" } });
    expect((await log.readAfter(0)).map((event) => event.type)).toEqual([
      "execution.run_requested",
      "execution.run_started",
      "execution.run_completed",
    ]);
    expect(runs.list()[0]).toMatchObject({ role: "architect", orderId: "WO-0001", status: "completed", costUsd: 0.25 });
  });

  it("reports an engine failure once, without retrying on its own", async () => {
    const engine = new FakeEngine(() => ({ kind: "failed", message: "rate limited" }));
    const { scheduler, runs } = await createScheduler(engine, 1);

    const outcome = await scheduler.submit(submission());

    expect(outcome).toMatchObject({ ok: false, error: { kind: "failed", message: "rate limited" } });
    expect(engine.requests).toHaveLength(1);
    expect(runs.list()[0]).toMatchObject({ status: "failed", failure: { message: "rate limited" } });
  });

  it("turns an engine that throws into a failed run and keeps serving the queue", async () => {
    let calls = 0;
    const engine = new FakeEngine(() => {
      if (++calls === 1) throw new Error("spawn exploded");
      return { text: "fine" };
    });
    const { scheduler } = await createScheduler(engine, 1);

    const [broken, healthy] = await Promise.all([scheduler.submit(submission()), scheduler.submit(submission())]);

    expect(broken).toMatchObject({ ok: false, error: { kind: "failed", message: "spawn exploded" } });
    expect(healthy.ok).toBe(true);
  });

  it("fails fast when the requested engine is not configured", async () => {
    const { scheduler, runs } = await createScheduler(null, 1);

    expect(await scheduler.submit(submission())).toMatchObject({ ok: false, error: { kind: "engine_unavailable" } });
    expect(runs.list()[0]?.status).toBe("failed");
  });
});

describe("stopping runs", () => {
  const untilStopped = (request: EngineRequest) =>
    new Promise<{ text: string }>((resolve) => request.signal?.addEventListener("abort", () => resolve({ text: "late" })));

  it("kills a running run through its signal and records it as stopped", async () => {
    const engine = new FakeEngine(untilStopped);
    const { scheduler, runs } = await createScheduler(engine, 2);
    const outcome = scheduler.submit(submission());
    await waitFor(() => runs.list()[0]?.status === "running");

    const found = await scheduler.cancel(runs.list()[0]!.id);
    await outcome;

    expect(found).toBe(true);
    expect(engine.requests[0]?.signal?.aborted).toBe(true);
  });

  it("takes a queued run out of the queue without ever starting it", async () => {
    const { engine, release } = gatedEngine();
    const { scheduler, runs } = await createScheduler(engine, 1);
    const first = scheduler.submit(submission("developer", "WO-0001"));
    await waitFor(() => engine.requests.length === 1);
    const second = scheduler.submit(submission("developer", "WO-0002"));
    await waitFor(() => runs.list().length === 2);
    const queued = runs.list().find((run) => run.orderId === "WO-0002")!;

    expect(await scheduler.cancel(queued.id)).toBe(true);

    expect(await second).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    expect(runs.list().find((run) => run.id === queued.id)).toMatchObject({ status: "failed", failure: { kind: "cancelled" } });
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(engine.requests).toHaveLength(1);
  });

  it("does not run a request whose signal was already aborted", async () => {
    const engine = new FakeEngine();
    const { scheduler } = await createScheduler(engine, 1);
    const stop = new AbortController();
    stop.abort();

    const outcome = await scheduler.submit({ ...submission(), request: { ...request, signal: stop.signal } });

    expect(outcome).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    expect(engine.requests).toHaveLength(0);
  });

  it("stops a run when the signal of its request is aborted later", async () => {
    const engine = new FakeEngine(untilStopped);
    const { scheduler, runs } = await createScheduler(engine, 1);
    const stop = new AbortController();
    const outcome = scheduler.submit({ ...submission(), request: { ...request, signal: stop.signal } });
    await waitFor(() => runs.list()[0]?.status === "running");

    stop.abort();
    await outcome;

    expect(engine.requests[0]?.signal?.aborted).toBe(true);
  });

  it("stops a queued run when the signal of its request is aborted, without waiting for a slot", async () => {
    const { engine, release } = gatedEngine();
    const { scheduler, runs, log } = await createScheduler(engine, 1);
    const first = scheduler.submit(submission("developer", "WO-0001"));
    await waitFor(() => engine.requests.length === 1);
    const stop = new AbortController();
    const second = scheduler.submit({ ...submission("developer", "WO-0002"), request: { ...request, signal: stop.signal } });
    await waitFor(() => runs.list().length === 2);

    stop.abort();

    expect(await second).toMatchObject({ ok: false, error: { kind: "cancelled" } });
    const queued = runs.list().find((run) => run.orderId === "WO-0002")!;
    expect(queued).toMatchObject({ status: "failed", startedAt: null });
    expect((await log.readAfter(0)).filter((event) => event.type === "execution.run_started")).toHaveLength(1);
    release();
    await first;
    expect(engine.requests).toHaveLength(1);
  });

  it("says no for a run that is not live", async () => {
    const { scheduler } = await createScheduler(new FakeEngine(), 1);

    expect(await scheduler.cancel("run_unknown")).toBe(false);
  });
});
