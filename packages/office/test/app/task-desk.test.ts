import { describe, expect, it } from "vitest";
import { Schedule, ScheduleProjection } from "../../src/app/schedule";
import { createTaskDesk } from "../../src/app/task-desk";
import { fixedClock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";

async function taskDesk() {
  const clock = fixedClock(new Date("2026-01-01T00:00:00.000Z"));
  const log = new EventLog(new InMemoryEventStore(), clock);
  const timings = new ScheduleProjection();
  await attachProjection(log, timings);
  const schedule = new Schedule({ log, timings, clock, projects: () => ["p"], paused: () => false, run: async () => {} });
  return createTaskDesk(schedule, "p");
}

const scheduleOnce = async (once: string) =>
  (await taskDesk()).schedule({ title: "Look at the orders", text: "Tell me which orders are stuck.", when: { once }, requested: "" });

describe("the Manager's task desk", () => {
  it("schedules a task once on a date the calendar has", async () => {
    expect(await scheduleOnce("2026-03-02T10:00")).toMatchObject({ ok: true, value: { text: expect.stringContaining("2026-03-02 10:00") } });
  });

  it("refuses a month the calendar does not have, instead of failing the turn", async () => {
    expect(await scheduleOnce("2026-13-01T10:00")).toMatchObject({ ok: false, error: expect.stringContaining("2026-13-01T10:00") });
  });

  it("refuses a day the month does not have, instead of moving it to the next month", async () => {
    expect(await scheduleOnce("2026-02-31T10:00")).toMatchObject({ ok: false, error: expect.stringContaining("2026-02-31T10:00") });
  });
});
