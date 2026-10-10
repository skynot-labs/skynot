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

const submission = (orderId: string): RunSubmission => ({
  role: "developer",
  engine: "claude",
  orderId,
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
