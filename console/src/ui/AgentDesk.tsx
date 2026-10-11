import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Agent, Avatar, Order, Project, Send } from "../contracts";
import { agentWork, type Reach } from "../application/agent-work";
import { AvatarCanvas } from "./AvatarCanvas";
import { Icon } from "./Icon";
import { agentStatus, clock, dayTime, orderStatus, runOutcome, usd } from "./format";
import "./agent-desk.css";

type DeskTab = "work" | "soul" | "look";
const deskTabs: Array<{ id: DeskTab; name: string }> = [
  { id: "work", name: "Work" },
  { id: "soul", name: "Soul" },
  { id: "look", name: "Look" },
];
const TRACE_SHOWN = 12;
const RUNS_SHOWN = 6;
const MAX_FOCUS = 300;

export function AgentDesk({
  project,
  agent,
  name,
  avatar,
  send,
  busy,
  onOrder,
  onManager,
  look,
}: {
  project: Project;
  agent: Agent;
  name: string;
  avatar: Avatar;
  send: Send;
  busy: boolean;
  onOrder: (order: Order) => void;
  onManager: () => void;
  look: ComponentChildren;
}) {
  const [tab, setTab] = useState<DeskTab>("work");
  const live = agent.status === "working" || agent.status === "queued";
  return (
    <div class="agent-desk">
      <header class="agent-desk-head">
        <AvatarCanvas avatar={avatar} name={name} />
        <div>
          <strong>{name}</strong>
          <small>
            {agent.role} · {agent.engine} · {agent.model ?? "default model"}
          </small>
        </div>
        <span class={`status-chip ${agent.status}`}>
          {agentStatus[agent.status]}
          {agent.queuePosition !== null && ` · number ${agent.queuePosition}`}
        </span>
        {live && agent.runId && (
          <button
            class="secondary-button"
            disabled={busy}
            onClick={() =>
              void send({ name: "stop-run", payload: { runId: agent.runId! } })
            }
          >
            <Icon name="stop" />
            Stop this run
          </button>
        )}
      </header>
      <div class="agent-desk-tabs" role="tablist" aria-label="Agent">
        {deskTabs.map((item) => (
          <button
            type="button"
            role="tab"
            id={`agent-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`agent-panel-${item.id}`}
            onClick={() => setTab(item.id)}
            key={item.id}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`agent-panel-${tab}`}
        aria-labelledby={`agent-tab-${tab}`}
      >
        {tab === "work" && (
          <Work
            project={project}
            agent={agent}
            send={send}
            busy={busy}
            onOrder={onOrder}
            onManager={onManager}
          />
        )}
        {tab === "soul" && (
          <SoulPanel project={project} agent={agent} send={send} busy={busy} />
        )}
        {tab === "look" && look}
      </div>
    </div>
  );
}

function Work({
  project,
  agent,
  send,
  busy,
  onOrder,
  onManager,
}: {
  project: Project;
  agent: Agent;
  send: Send;
  busy: boolean;
  onOrder: (order: Order) => void;
  onManager: () => void;
}) {
  const work = agentWork(project, agent);
  const lastRun = work.runs[0];
  return (
    <div class="agent-work">
      <section class="agent-now">
        <span class="swatch-label">NOW</span>
        <p>
          {nowLine(agent, work.current, lastRun?.failure?.message, work.open.length)}
        </p>
        {work.open.map((order) => (
          <button
            class="work-preview-row"
            key={order.id}
            onClick={() => onOrder(order)}
          >
            <span class={`order-marker ${order.status}`} />
            <span class="mono muted">{order.id}</span>
            <span>{order.title}</span>
            <span class={`status-chip ${order.blocked ? "blocked" : order.status}`}>
              {order.blocked ? "Blocked" : orderStatus[order.status]}
            </span>
            <Icon name="arrow" />
          </button>
        ))}
        {work.retry && (
          <p class="agent-blocked">
            {work.retry.id} is blocked: {work.retry.blocked}
            <button
              class="text-button"
              disabled={busy}
              onClick={() =>
                void send({
                  name: "retry-order",
                  payload: { orderId: work.retry!.id },
                })
              }
            >
              Retry
              <Icon name="arrow" />
            </button>
          </p>
        )}
      </section>
      <Compose
        key={work.reach.kind}
        project={project}
        agent={agent}
        reach={work.reach}
        send={send}
        busy={busy}
        onManager={onManager}
      />
      <section>
        <span class="swatch-label">
          WHAT IT DID
          {agent.runs > 0 &&
            ` · ${agent.runs} ${agent.runs === 1 ? "RUN" : "RUNS"}${agent.spentUsd === null ? "" : ` · ${usd(agent.spentUsd)}`}`}
        </span>
        {work.trace.slice(0, TRACE_SHOWN).map((entry) => (
          <div class="agent-trace-entry" key={entry.sequence}>
            <time>{clock(entry.at)}</time>
            <p>
              {entry.text}
              {entry.orderId && <small>{entry.orderId}</small>}
            </p>
          </div>
        ))}
        {work.trace.length === 0 && (
          <p class="form-note">Nothing in this project's logbook yet.</p>
        )}
      </section>
      {work.runs.length > 0 && (
        <section>
          <span class="swatch-label">LAST RUNS</span>
          {work.runs.slice(0, RUNS_SHOWN).map((run) => (
            <div class="agent-run" key={run.runId}>
              <time>{run.finishedAt ? dayTime(run.finishedAt) : "—"}</time>
              {run.outcome && (
                <span class={`status-chip ${run.outcome}`}>
                  {runOutcome[run.outcome]}
                </span>
              )}
              <span class="agent-run-detail" title={run.failure?.message}>
                {run.failure?.message ?? run.orderId ?? "no order"}
              </span>
              <span class="mono">
                {run.costUsd === null ? "—" : usd(run.costUsd)}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function nowLine(
  agent: Agent,
  current: Order | null,
  lastFailure: string | undefined,
  held: number,
): string {
  const on = current ? `${current.id}, ${current.title}` : agent.orderId;
  switch (agent.status) {
    case "working":
      return on ? `Working on ${on}.` : "Working on a turn.";
    case "queued":
      return `In line${on ? ` for ${on}` : ""}; it starts when a slot frees up.`;
    case "waiting-director":
      return current?.question
        ? `Stopped to ask you: ${current.question}`
        : "Waiting on your answer.";
    case "error":
      return `The last run failed${lastFailure ? `: ${lastFailure}` : "."}`;
    default:
      return held > 0
        ? "Nothing running. What it holds is waiting on a review, a merge or you."
        : "At the desk, with nothing in hand.";
  }
}

const composeCopy = (reach: Reach, agent: Agent) =>
  reach.kind === "answer"
    ? {
        label: `ANSWER ${reach.order.id}`,
        placeholder: "Your answer; the order goes on with it.",
        button: "Answer",
        note: "The order resumes with your answer in its instructions.",
      }
    : reach.kind === "redirect"
      ? {
          label: `REDIRECT ${reach.order.id}`,
          placeholder: "What should change in this pull request?",
          button: "Send the follow-up",
          note: "Starts a new run on the same pull request with this instruction.",
        }
      : agent.kind === "manager"
        ? {
            label: "TALK TO THE MANAGER",
            placeholder: "An idea, a bug, a question…",
            button: "Send",
            note: "Opens the chat with the answer.",
          }
        : {
            label: "ASK THROUGH THE MANAGER",
            placeholder: `What do you want from ${agent.role}?`,
            button: "Send to the Manager",
            note: `Nothing here is addressed to ${agent.role} directly right now: the Manager takes it and decides whether to consult, ask or write an order.`,
          };

function Compose({
  project,
  agent,
  reach,
  send,
  busy,
  onManager,
}: {
  project: Project;
  agent: Agent;
  reach: Reach;
  send: Send;
  busy: boolean;
  onManager: () => void;
}) {
  const [text, setText] = useState("");
  const copy = composeCopy(reach, agent);
  async function submit(event: Event) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    if (reach.kind === "answer") {
      if (await send({ name: "answer-question", payload: { orderId: reach.order.id, answer: value } })) setText("");
    } else if (reach.kind === "redirect") {
      if (await send({ name: "follow-up", payload: { orderId: reach.order.id, text: value } })) setText("");
    } else {
      const message = agent.kind === "manager" ? value : `About ${agent.id}: ${value}`;
      if (await send({ name: "send-message", payload: { text: message, project: project.id } })) onManager();
    }
  }
  return (
    <form class="agent-compose" onSubmit={submit}>
      <label class="swatch-label" for="agentCompose">
        {copy.label}
      </label>
      {reach.kind === "answer" && (
        <p class="agent-question">{reach.order.question}</p>
      )}
      <div class="chat-compose">
        <textarea
          id="agentCompose"
          rows={2}
          maxLength={3900}
          value={text}
          placeholder={copy.placeholder}
          onInput={(event) => setText(event.currentTarget.value)}
        />
        <button
          class="primary-button"
          type="submit"
          disabled={busy || !text.trim()}
        >
          {copy.button}
          <Icon name="arrow" />
        </button>
      </div>
      <p class="form-note">{copy.note}</p>
    </form>
  );
}

function SoulPanel({
  project,
  agent,
  send,
  busy,
}: {
  project: Project;
  agent: Agent;
  send: Send;
  busy: boolean;
}) {
  const soul = agent.soul;
  const [focus, setFocus] = useState(soul?.focus ?? "");
  if (!soul)
    return (
      <div class="agent-soul">
        <p class="agent-soul-empty">
          {agent.kind === "manager"
            ? "The Manager has no soul file. Its rules are part of the service, and what it knows about this project is the briefing in Context."
            : "This role has no soul file. A worker takes its instructions from the work order it holds and from the project's rules."}
        </p>
        <p class="form-note">
          Engine and model come from the team file: {agent.engine} ·{" "}
          {agent.model ?? "default model"}.
        </p>
      </div>
    );
  const changed = focus.trim() !== (soul.focus ?? "") && focus.trim().length >= 3;
  return (
    <div class="agent-soul">
      <span class="swatch-label">WHAT THE MANAGER SEES</span>
      <p class="agent-soul-description">{soul.description}</p>
      <span class="swatch-label">SOUL · READ FROM ITS FILE AT STARTUP</span>
      <pre class="agent-soul-text">{soul.soul}</pre>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (changed)
            void send({
              name: "set-focus",
              payload: { project: project.id, role: agent.id, focus: focus.trim() },
            });
        }}
      >
        <label class="swatch-label" for="agentFocus">
          FOCUS · ADDED TO THE SOUL ON EVERY CONSULTATION
        </label>
        <textarea
          id="agentFocus"
          rows={3}
          maxLength={MAX_FOCUS}
          value={focus}
          placeholder="What should this role concentrate on in this project?"
          onInput={(event) => setFocus(event.currentTarget.value)}
        />
        <div class="modal-actions">
          <p class="form-note">
            Takes effect on the next consultation and stays in the logbook.
            The soul itself changes in its file, with a restart.
          </p>
          <button
            class="primary-button"
            type="submit"
            disabled={busy || !changed}
          >
            Set the focus
            <Icon name="check" />
          </button>
        </div>
      </form>
    </div>
  );
}
