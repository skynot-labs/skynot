import { describe, expect, it } from "vitest";
import { fixedClock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { FakeEngine, RunScheduler, RunsProjection, ShopControl, type RunSubmission } from "../../src/execution";

async function open(store = new InMemoryEventStore()) {
  const log = new EventLog(store, fixedClock(new Date("2026-10-11T12:00:00.000Z")));
  const control = new ShopControl(log);
  const runs = new RunsProjection();
  await attachProjection(log, control);
  await attachProjection(log, runs);
  return { log, control, runs, store };
}

const submission = (orderId: string, projectId?: string): RunSubmission => ({
  role: "developer",
  engine: "claude",
  orderId,
  ...(projectId && { projectId }),
  request: { prompt: "do it", cwd: "/tmp/work", access: "read", timeoutMs: 1000 },
});

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was never met");
}

describe("shop control", () => {
  it("pauses with a reason and resumes", async () => {
    const { control } = await open();
    expect(control.paused()).toBeNull();

    const paused = await control.pause("daily cap reached");
    expect(paused).toMatchObject({ ok: true, value: { reason: "daily cap reached" } });
    expect(control.paused()).toMatchObject({ reason: "daily cap reached" });

    expect(await control.resume()).toMatchObject({ ok: true });
    expect(control.paused()).toBeNull();
  });

  it("refuses to pause twice and to resume what is not paused", async () => {
    const { control } = await open();

    expect(await control.resume()).toMatchObject({ ok: false });
    await control.pause("first");
    expect(await control.pause("second")).toMatchObject({ ok: false });
    expect(control.paused()?.reason).toBe("first");
  });

  it("stays paused after a restart", async () => {
    const first = await open();
    await first.control.pause("going home");

    const restarted = await open(first.store);

    expect(restarted.control.paused()).toMatchObject({ reason: "going home" });
  });
});

describe("pausing one project", () => {
  it("pauses and resumes a project without pausing the shop or another project", async () => {
    const { control } = await open();

    expect(await control.pauseProject("alpha", "waiting for the client")).toMatchObject({ ok: true, value: { reason: "waiting for the client", since: "2026-10-11T12:00:00.000Z" } });

    expect(control.projectPaused("alpha")).toMatchObject({ reason: "waiting for the client" });
    expect(control.pausedFor("alpha")).toMatchObject({ reason: "waiting for the client" });
    expect([control.projectPaused("beta"), control.pausedFor("beta"), control.pausedFor(), control.paused()]).toEqual([null, null, null, null]);

    expect(await control.resumeProject("alpha")).toMatchObject({ ok: true });
    expect(control.pausedFor("alpha")).toBeNull();
  });

  it("refuses to pause a paused project and to resume one that is not paused", async () => {
    const { control } = await open();

    expect(await control.resumeProject("alpha")).toMatchObject({ ok: false });
    await control.pauseProject("alpha", "first");
    expect(await control.pauseProject("alpha", "second")).toMatchObject({ ok: false });
    expect(await control.resumeProject("beta")).toMatchObject({ ok: false });
    expect(control.projectPaused("alpha")?.reason).toBe("first");
  });

  it("answers with the shop pause first, and keeps the project paused when the shop resumes", async () => {
    const { control } = await open();
    await control.pauseProject("alpha", "waiting for the client");
    await control.pause("lunch");

    expect(control.pausedFor("alpha")?.reason).toBe("lunch");
    expect(control.pausedFor("beta")?.reason).toBe("lunch");
    expect(control.projectPaused("alpha")?.reason).toBe("waiting for the client");

    await control.resume();

    expect(control.paused()).toBeNull();
    expect(control.pausedFor("alpha")?.reason).toBe("waiting for the client");
    expect(control.pausedFor("beta")).toBeNull();
  });

  it("keeps a project paused after a restart, and resumed once it was resumed", async () => {
    const first = await open();
    await first.control.pauseProject("alpha", "waiting for the client");
    await first.control.pauseProject("beta", "budget");
    await first.control.resumeProject("beta");

    const restarted = await open(first.store);

    expect(restarted.control.projectPaused("alpha")).toMatchObject({ reason: "waiting for the client" });
    expect(restarted.control.projectPaused("beta")).toBeNull();
    expect(restarted.control.paused()).toBeNull();
  });
});

describe("a scheduler with one project paused", () => {
  async function shop(maxParallel = 1) {
    const { log, control, runs } = await open();
    const engine = new FakeEngine();
    const scheduler = new RunScheduler({ claude: engine }, log, maxParallel, (projectId) => control.pausedFor(projectId) !== null);
    return { control, runs, engine, scheduler };
  }
  const statusOf = (runs: RunsProjection, orderId: string) => runs.list().find((run) => run.orderId === orderId)?.status;

  it("holds the paused project's run and starts another project's run queued behind it", async () => {
    const { control, runs, engine, scheduler } = await shop();
    await control.pauseProject("alpha", "waiting for the client");

    const held = scheduler.submit(submission("WO-0001", "alpha"));
    const behind = scheduler.submit(submission("WO-0002", "beta"));

    expect(await behind).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statusOf(runs, "WO-0001")).toBe("queued");
    expect(engine.requests).toHaveLength(1);

    await control.resumeProject("alpha");

    expect(await held).toMatchObject({ ok: true });
    expect(engine.requests).toHaveLength(2);
  });

  it("does not start the held run when a different project resumes", async () => {
    const { control, runs, engine, scheduler } = await shop();
    await control.pauseProject("alpha", "waiting for the client");
    await control.pauseProject("beta", "budget");
    void scheduler.submit(submission("WO-0001", "alpha"));
    const other = scheduler.submit(submission("WO-0002", "beta"));
    await waitFor(() => runs.list().length === 2);

    await control.resumeProject("beta");

    expect(await other).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statusOf(runs, "WO-0001")).toBe("queued");
    expect(engine.requests).toHaveLength(1);
  });

  it("holds every project while the shop is paused, and only the paused project once the shop resumes", async () => {
    const { control, runs, engine, scheduler } = await shop(2);
    await control.pauseProject("alpha", "waiting for the client");
    await control.pause("lunch");
    void scheduler.submit(submission("WO-0001", "alpha"));
    const other = scheduler.submit(submission("WO-0002", "beta"));
    await waitFor(() => runs.list().length === 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(engine.requests).toHaveLength(0);

    await control.resume();

    expect(await other).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statusOf(runs, "WO-0001")).toBe("queued");
    expect(engine.requests).toHaveLength(1);
  });

  it("lets a run of the project finish when the pause arrives after it started", async () => {
    const { log, control } = await open();
    let release!: () => void;
    const engine = new FakeEngine(() => new Promise((resolve) => (release = () => resolve({ text: "done" }))));
    const scheduler = new RunScheduler({ claude: engine }, log, 2, (projectId) => control.pausedFor(projectId) !== null);

    const started = scheduler.submit(submission("WO-0001", "alpha"));
    await waitFor(() => engine.requests.length === 1);
    await control.pauseProject("alpha", "waiting for the client");
    release();

    expect(await started).toMatchObject({ ok: true });
  });
});

describe("a paused scheduler", () => {
  async function paused() {
    const { log, control, runs } = await open();
    const engine = new FakeEngine();
    const scheduler = new RunScheduler({ claude: engine }, log, 2, () => control.paused() !== null);
    return { control, runs, engine, scheduler };
  }

  it("holds new runs in the queue and starts them when the shop resumes", async () => {
    const { control, runs, engine, scheduler } = await paused();
    await control.pause("lunch");

    const outcome = scheduler.submit(submission("WO-0001"));
    await waitFor(() => runs.list().length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(runs.list()[0]?.status).toBe("queued");
    expect(engine.requests).toHaveLength(0);

    await control.resume();

    expect(await outcome).toMatchObject({ ok: true });
    expect(engine.requests).toHaveLength(1);
  });

  it("lets a run that already started finish, and holds only the ones behind it", async () => {
    const { log, control } = await open();
    let release!: () => void;
    const engine = new FakeEngine(() => new Promise((resolve) => (release = () => resolve({ text: "done" }))));
    const scheduler = new RunScheduler({ claude: engine }, log, 2, () => control.paused() !== null);

    const first = scheduler.submit(submission("WO-0001"));
    await waitFor(() => engine.requests.length === 1);
    await control.pause("lunch");
    const second = scheduler.submit(submission("WO-0002"));
    release();

    expect(await first).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(engine.requests).toHaveLength(1);

    await control.resume();
    await waitFor(() => engine.requests.length === 2);
    release();
    expect(await second).toMatchObject({ ok: true });
  });
});
