import type { Clock } from "../kernel";
import type { EventRecorder, Projection, StoredEvent } from "../kernel/events";
import type { ScheduledTask } from "../manager";

export const MORNING_REPORT: ScheduledTask = {
  id: "morning-report",
  title: "Morning report",
  text: [
    "Write the morning report, in at most 6 short lines:",
    "- what was delivered since your last report;",
    "- the pull requests waiting for the director to merge;",
    "- the questions waiting for the director;",
    "- what the shop spent yesterday and so far today;",
    "- what you propose to do today.",
    "Take the facts from \"Where the shop stands\" and the lists above, and say \"nothing\" for a part that has nothing. Do not propose a plan here: say what you would propose.",
  ].join("\n"),
};

const TASKS: readonly ScheduledTask[] = [MORNING_REPORT];
const DEFAULT_AT = "09:00";

export interface Timing {
  readonly on: boolean;
  readonly at: string;
  readonly setAt: string | null;
  readonly lastRun: { readonly due: string; readonly outcome: "fired" | "skipped" } | null;
}

const NEVER_SET: Timing = { on: false, at: DEFAULT_AT, setAt: null, lastRun: null };

// The latest moment, at or before `now`, when the office's own clock read `at`.
export function lastDue(at: string, now: Date): Date {
  const due = onDay(at, now);
  if (due > now) due.setDate(due.getDate() - 1);
  return due;
}

export function nextDue(at: string, now: Date): Date {
  const due = onDay(at, now);
  if (due <= now) due.setDate(due.getDate() + 1);
  return due;
}

function onDay(at: string, day: Date): Date {
  const [hours, minutes] = at.split(":").map(Number);
  const moment = new Date(day);
  moment.setHours(hours!, minutes!, 0, 0);
  return moment;
}

export class ScheduleProjection implements Projection {
  private readonly timings = new Map<string, Timing>();

  apply(event: StoredEvent): void {
    if (!event.type.startsWith("schedule.")) return;
    const { projectId, taskId, on, at, due } = event.payload as { projectId: string; taskId: string; on?: boolean; at?: string; due?: string };
    const current = this.timing(projectId, taskId);
    if (event.type === "schedule.task_set") this.timings.set(key(projectId, taskId), { ...current, on: on!, at: at!, setAt: event.occurredAt });
    if (event.type === "schedule.task_fired") this.timings.set(key(projectId, taskId), { ...current, lastRun: { due: due!, outcome: "fired" } });
    if (event.type === "schedule.task_skipped") this.timings.set(key(projectId, taskId), { ...current, lastRun: { due: due!, outcome: "skipped" } });
  }

  timing(projectId: string, taskId: string): Timing {
    return this.timings.get(key(projectId, taskId)) ?? NEVER_SET;
  }
}

const key = (projectId: string, taskId: string) => `${projectId}/${taskId}`;

export interface ScheduleDependencies {
  log: EventRecorder;
  timings: ScheduleProjection;
  clock: Clock;
  projects(): readonly string[];
  paused(projectId: string): boolean;
  run(projectId: string, task: ScheduledTask): Promise<void>;
  onError?: (error: unknown) => void;
}

export class Schedule {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(private readonly deps: ScheduleDependencies) {}

  async set(projectId: string, taskId: string, timing: { on: boolean; at: string }): Promise<boolean> {
    if (!TASKS.some((task) => task.id === taskId)) return false;
    await this.deps.log.record([{ type: "schedule.task_set", payload: { projectId, taskId, ...timing } }]);
    return true;
  }

  tasks(projectId: string) {
    const now = this.deps.clock.now();
    return TASKS.map((task) => {
      const { on, at, lastRun } = this.deps.timings.timing(projectId, task.id);
      return { id: task.id, title: task.title, on, at, nextAt: on ? nextDue(at, now).toISOString() : null, lastRun: lastRun && { at: lastRun.due, outcome: lastRun.outcome } };
    });
  }

  // The first poll is at once: a firing the office slept through is caught up when it starts.
  start(intervalMs: number): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const projectId of this.deps.projects()) for (const task of TASKS) await this.fireIfDue(projectId, task);
    } finally {
      this.polling = false;
    }
  }

  // Only the latest moment that was due counts, and once: an office that was off for days writes one report, not one per day.
  private async fireIfDue(projectId: string, task: ScheduledTask): Promise<void> {
    const { log, timings, clock, paused, run, onError } = this.deps;
    const { on, at, setAt, lastRun } = timings.timing(projectId, task.id);
    if (!on || setAt === null) return;
    const due = lastDue(at, clock.now()).toISOString();
    if (due <= setAt || (lastRun && lastRun.due >= due)) return;

    if (paused(projectId)) {
      await log.record([{ type: "schedule.task_skipped", payload: { projectId, taskId: task.id, due, reason: "paused" } }]);
      return;
    }
    await log.record([{ type: "schedule.task_fired", payload: { projectId, taskId: task.id, due } }]);
    await run(projectId, task).catch((error) => onError?.(error));
  }
}
