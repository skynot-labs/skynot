import { err, ok } from "../kernel";
import { WEEKDAYS, type TaskDesk } from "../manager";
import { describeWhen, officeTime, type Schedule } from "./schedule";

// The Manager schedules a task the way the director's commands would: the schedule's own refusals hold here too.
export function createTaskDesk(schedule: Schedule, projectId: string): TaskDesk {
  return {
    clock: () => officeTime(schedule.now()),
    scheduled: () => schedule.entries(projectId).filter((entry) => entry.on).map((entry) => ({ title: entry.task.title, when: describeWhen(entry.when) })),
    async schedule({ title, text, when, requested }) {
      if ("once" in when && !onTheCalendar(when.once)) return err(`${when.once} is not a date on the calendar`);
      // A date and a time without a zone is read on the office's own clock.
      const moment = "once" in when ? { once: new Date(when.once).toISOString() } : { at: when.at, days: when.days.map((day) => WEEKDAYS.indexOf(day)).sort() };
      const added = await schedule.add(projectId, { title, text, when: moment, requested });
      return added.ok ? ok({ text: `Scheduled "${title}": ${added.value.when}.` }) : err(added.error);
    },
  };
}

// new Date() moves an impossible day to the next month and a time inside a clock change to the next hour; reading it back shows either.
const onTheCalendar = (localDateTime: string): boolean => {
  const moment = new Date(localDateTime);
  return !Number.isNaN(moment.getTime()) && officeTime(moment).endsWith(localDateTime.replace("T", " "));
};
