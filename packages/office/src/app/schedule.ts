import { err, newId, ok, type Clock, type Result } from "../kernel";
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

const DEFAULT_AT = "09:00";
export const DEFAULT_MAX_TASKS = 10;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Once at a moment, or every time the office's own clock reads `at` on one of `days` (0 is Sunday; none means every day).
export type When = { readonly once: string } | { readonly at: string; readonly days: readonly number[] };

export interface Entry {
  readonly task: ScheduledTask;
  readonly when: When;
  readonly on: boolean;
  // When it was last set: a moment that was due before that is not caught up.
  readonly since: string | null;
  readonly lastRun: { readonly due: string; readonly outcome: "fired" | "skipped" } | null;
  // The morning report is always there to switch on; a task the director asked for can be removed.
  readonly builtIn: boolean;
}

const MORNING_OFF: Entry = { task: MORNING_REPORT, when: { at: DEFAULT_AT, days: [] }, on: false, since: null, lastRun: null, builtIn: true };

// The latest moment, at or before `now`, when the office's own clock read `at` on one of `days`.
export function lastDue(at: string, now: Date, days: readonly number[] = []): Date {
  const due = onDay(at, now);
  if (due > now) due.setDate(due.getDate() - 1);
  while (days.length > 0 && !days.includes(due.getDay())) due.setDate(due.getDate() - 1);
  return due;
}

export function nextDue(at: string, now: Date, days: readonly number[] = []): Date {
  const due = onDay(at, now);
  if (due <= now) due.setDate(due.getDate() + 1);
  while (days.length > 0 && !days.includes(due.getDay())) due.setDate(due.getDate() + 1);
  return due;
}

function onDay(at: string, day: Date): Date {
  const [hours, minutes] = at.split(":").map(Number);
  const moment = new Date(day);
  moment.setHours(hours!, minutes!, 0, 0);
  return moment;
}

const two = (value: number) => String(value).padStart(2, "0");

// A moment as the office's own clock shows it.
export function officeTime(moment: Date): string {
  return `${WEEKDAYS[moment.getDay()]} ${moment.getFullYear()}-${two(moment.getMonth() + 1)}-${two(moment.getDate())} ${two(moment.getHours())}:${two(moment.getMinutes())}`;
}

export function describeWhen(when: When): string {
  if ("once" in when) return `once, on ${officeTime(new Date(when.once))}`;
  const days = when.days.length === 0 ? "every day" : `every ${when.days.map((day) => WEEKDAYS[day]).join(", ")}`;
  return `${days} at ${when.at}`;
}

export class ScheduleProjection implements Projection {
  private readonly byProject = new Map<string, Map<string, Entry>>();

  apply(event: StoredEvent): void {
    if (!event.type.startsWith("schedule.")) return;
    const payload = event.payload as { projectId: string; taskId: string };
    const entries = this.byProject.get(payload.projectId) ?? new Map<string, Entry>([[MORNING_REPORT.id, MORNING_OFF]]);
    this.byProject.set(payload.projectId, entries);
    const current = entries.get(payload.taskId);

    if (event.type === "schedule.task_added") {
      const { title, text, when, requested } = event.payload as { title: string; text: string; when: When; requested: string };
      entries.set(payload.taskId, { task: { id: payload.taskId, title, text, requested }, when, on: true, since: event.occurredAt, lastRun: null, builtIn: false });
    }
    if (!current) return;
    if (event.type === "schedule.task_removed") entries.delete(payload.taskId);
    if (event.type === "schedule.task_set") {
      const { on, at } = event.payload as { on: boolean; at: string };
      entries.set(payload.taskId, { ...current, on, when: { at, days: [] }, since: event.occurredAt });
    }
    if (event.type === "schedule.task_fired" || event.type === "schedule.task_skipped") {
      const { due } = event.payload as { due: string };
      if ("once" in current.when) entries.delete(payload.taskId);
      else entries.set(payload.taskId, { ...current, lastRun: { due, outcome: event.type === "schedule.task_fired" ? "fired" : "skipped" } });
    }
  }

  entries(projectId: string): Entry[] {
    return [...(this.byProject.get(projectId)?.values() ?? [MORNING_OFF])];
  }
}

export interface TaskRequest {
  readonly title: string;
  readonly text: string;
  readonly when: When;
  // The director's message that asked for it.
  readonly requested: string;
}

export interface ScheduleDependencies {
  log: EventRecorder;
  timings: ScheduleProjection;
  clock: Clock;
  maxTasks?: number;
  projects(): readonly string[];
  paused(projectId: string): boolean;
  run(projectId: string, task: ScheduledTask): Promise<void>;
  onError?: (error: unknown) => void;
}

export class Schedule {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(private readonly deps: ScheduleDependencies) {}

  // The morning report's switch and its time of day.
  async set(projectId: string, taskId: string, timing: { on: boolean; at: string }): Promise<boolean> {
    if (taskId !== MORNING_REPORT.id) return false;
    await this.deps.log.record([{ type: "schedule.task_set", payload: { projectId, taskId, ...timing } }]);
    return true;
  }

  async add(projectId: string, request: TaskRequest): Promise<Result<{ id: string; when: string }, string>> {
    const { log, timings, clock, maxTasks = DEFAULT_MAX_TASKS } = this.deps;
    if ("once" in request.when && new Date(request.when.once) <= clock.now()) return err(`${officeTime(new Date(request.when.once))} has already passed; the office's clock reads ${officeTime(clock.now())}`);
    if (timings.entries(projectId).filter((entry) => !entry.builtIn).length >= maxTasks) return err(`this project already has ${maxTasks} scheduled tasks, the most the policy allows; one has to be removed at the clock first`);

    const id = newId("tsk");
    await log.record([{ type: "schedule.task_added", payload: { projectId, taskId: id, ...request } }]);
    return ok({ id, when: describeWhen(request.when) });
  }

  async remove(projectId: string, taskId: string): Promise<boolean> {
    if (!this.deps.timings.entries(projectId).some((entry) => entry.task.id === taskId && !entry.builtIn)) return false;
    await this.deps.log.record([{ type: "schedule.task_removed", payload: { projectId, taskId } }]);
    return true;
  }

  entries(projectId: string): Entry[] {
    return this.deps.timings.entries(projectId);
  }

  next(entry: Entry): Date | null {
    if (!entry.on) return null;
    return "once" in entry.when ? new Date(entry.when.once) : nextDue(entry.when.at, this.deps.clock.now(), entry.when.days);
  }

  now(): Date {
    return this.deps.clock.now();
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
      for (const projectId of this.deps.projects()) for (const entry of this.deps.timings.entries(projectId)) await this.fireIfDue(projectId, entry);
    } finally {
      this.polling = false;
    }
  }

  // Only the latest moment that was due counts, and once: an office that was off for days writes one report, not one per day.
  private async fireIfDue(projectId: string, { task, when, on, since, lastRun }: Entry): Promise<void> {
    const { log, clock, paused, run, onError } = this.deps;
    if (!on || since === null) return;
    const once = "once" in when;
    const moment = once ? new Date(when.once) : lastDue(when.at, clock.now(), when.days);
    if (moment > clock.now()) return;
    const due = moment.toISOString();
    if (!once && (due <= since || (lastRun && lastRun.due >= due))) return;

    if (paused(projectId)) {
      // What was asked for once is not lost to a pause: it waits for the shop to resume.
      if (!once) await log.record([{ type: "schedule.task_skipped", payload: { projectId, taskId: task.id, due, reason: "paused" } }]);
      return;
    }
    await log.record([{ type: "schedule.task_fired", payload: { projectId, taskId: task.id, due } }]);
    await run(projectId, task).catch((error) => onError?.(error));
  }
}
