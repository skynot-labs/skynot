import { useEffect, useState } from "preact/hooks";
import type { Project, ScheduledTask, Send } from "../contracts";
import { Icon } from "./Icon";
import { RichText } from "./RichText";
import { ago, dayTime } from "./format";
import "./reports.css";

export function ReportsView({ project, fresh, onClock }: { project: Project; fresh: number; onClock: () => void }) {
  if (project.reports.length === 0)
    return (
      <section class="panel empty-state">
        <p>No report yet. The Manager writes one when a scheduled task is due.</p>
        <button class="secondary-button" onClick={onClock}>
          <Icon name="clock" />
          Open the clock
        </button>
      </section>
    );
  return (
    <section class="panel reports-panel">
      {project.reports.map((report, index) => (
        <article class={`report ${index < fresh ? "report-new" : ""}`} key={report.id}>
          <header>
            <h3>{report.title}</h3>
            {index < fresh && <b class="report-mark">New</b>}
            <time title={dayTime(report.at)}>
              {dayTime(report.at)} · {ago(report.at)}
            </time>
          </header>
          {report.requested && <p class="report-requested">You asked: {report.requested}</p>}
          <RichText text={report.text} />
        </article>
      ))}
    </section>
  );
}

const LAST_RUN: Record<NonNullable<ScheduledTask["lastRun"]>["outcome"], string> = {
  fired: "Last written for",
  skipped: "Skipped, the shop was paused, on",
};

export function ScheduleView({ project, send, unread, onReports }: { project: Project; send: Send; unread: number; onReports: () => void }) {
  return (
    <section class="panel schedule-panel">
      {(project.schedule ?? []).map((task) =>
        task.removable ? <AskedTaskRow key={task.id} projectId={project.id} task={task} send={send} /> : <ScheduledTaskRow key={task.id} projectId={project.id} task={task} send={send} />,
      )}
      <button class="secondary-button" onClick={onReports}>
        <Icon name="report" />
        Read the reports
        {unread > 0 && <b class="nav-counter">{unread}</b>}
      </button>
    </section>
  );
}

// A task the director asked the Manager for: it is read and removed here, and changed by asking again.
function AskedTaskRow({ projectId, task, send }: { projectId: string; task: ScheduledTask; send: Send }) {
  return (
    <article class="scheduled-task">
      <h3>{task.title}</h3>
      <p class="scheduled-task-next">
        {task.when}
        {task.nextAt && ` · next: ${dayTime(task.nextAt)}`}
      </p>
      {task.requested && <p class="scheduled-task-last">You asked: {task.requested}</p>}
      {task.lastRun && (
        <p class="scheduled-task-last">
          {LAST_RUN[task.lastRun.outcome]} {dayTime(task.lastRun.at)}
        </p>
      )}
      <button class="secondary-button" onClick={() => void send({ name: "remove-task", payload: { project: projectId, task: task.id } })} aria-label={`Remove the task ${task.title}`}>
        <Icon name="close" />
        Remove
      </button>
    </article>
  );
}

function ScheduledTaskRow({ projectId, task, send }: { projectId: string; task: ScheduledTask; send: Send }) {
  const [at, setAt] = useState(task.at);
  // The switch answers at once and falls back if the office refuses.
  const [on, setOn] = useState(task.on);
  useEffect(() => setOn(task.on), [task.on]);
  const set = async (next: boolean, time: string) => {
    setOn(next);
    if (!(await send({ name: "schedule-task", payload: { project: projectId, task: task.id, on: next, at: time } }))) setOn(task.on);
  };
  return (
    <article class="scheduled-task">
      <label class="scheduled-task-switch">
        <input type="checkbox" role="switch" checked={on} onChange={(event) => void set(event.currentTarget.checked, at)} />
        <span>{task.title}</span>
      </label>
      <label class="scheduled-task-time">
        <span>Every day at</span>
        <input
          type="time"
          value={at}
          required
          onChange={(event) => {
            const time = event.currentTarget.value;
            if (!time) return;
            setAt(time);
            if (on) void set(true, time);
          }}
        />
        <small>on the office's clock</small>
      </label>
      <p class="scheduled-task-next">{task.nextAt ? `Next: ${dayTime(task.nextAt)}` : "Off: nothing is scheduled."}</p>
      {task.lastRun && (
        <p class="scheduled-task-last">
          {LAST_RUN[task.lastRun.outcome]} {dayTime(task.lastRun.at)}
        </p>
      )}
    </article>
  );
}
