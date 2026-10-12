import { useState } from "preact/hooks";
import type {
  Activity,
  Agent,
  Finding,
  Order,
  Project,
  Run,
  Send,
  Snapshot,
  TokenUsage,
} from "../contracts";
import type { Appearance } from "../application/appearance";
import { studioAgentAppearance } from "../studio/presentation";
import {
  defaultStudioPreferences,
  type StudioPreferences,
} from "../studio/model";
import { AvatarCanvas } from "./AvatarCanvas";
import { Icon } from "./Icon";
import { RichText } from "./RichText";
import {
  agentStatus,
  ago,
  dayTime,
  orderStatus,
  runOutcome,
  tokenCount,
  usd,
} from "./format";
import "./views.css";

const STAGES: Array<{
  name: string;
  statuses: Order["status"][];
  color: string;
}> = [
  {
    name: "Needs your signature",
    statuses: ["awaiting_signature"],
    color: "var(--peach)",
  },
  {
    name: "On the bench",
    statuses: ["signed", "on_bench"],
    color: "var(--lavender)",
  },
  { name: "In review", statuses: ["in_review"], color: "var(--blue)" },
  { name: "Delivered", statuses: ["delivered"], color: "var(--mint)" },
  { name: "Discarded", statuses: ["discarded"], color: "var(--muted)" },
];

const CHECKS_LABEL = {
  none: "no checks",
  pending: "checks running",
  passing: "checks passing",
  failing: "checks failing",
} as const;

function deliveryState(order: Order) {
  return [
    order.pullRequest !== null && `PR #${order.pullRequest}`,
    order.checks && order.checks !== "none" && CHECKS_LABEL[order.checks],
    order.review?.verdict === "approved" && "approved",
    order.review?.verdict === "changes_requested" && "changes requested",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function OrdersView({
  project,
  onOrder,
}: {
  project: Project;
  onOrder: (o: Order) => void;
}) {
  const [search, setSearch] = useState("");
  const orders = project.orders.filter((o) =>
    (o.title + " " + o.id).toLowerCase().includes(search.toLowerCase()),
  );
  const discarded = project.orders.some((o) => o.status === "discarded");
  const stages = STAGES.filter(
    (stage) => discarded || !stage.statuses.includes("discarded"),
  );
  return (
    <>
      <div class="view-toolbar">
        <div>
          <h2>From idea to delivery.</h2>
          <p>
            Signature, work, review and delivery. Every step leaves a trace.
          </p>
        </div>
        <input
          type="search"
          placeholder="Find an order…"
          aria-label="Search work orders"
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>
      {project.orders.length === 0 ? (
        <section class="panel">
          <div class="empty-state">
            No work orders yet. They appear here when the Manager files one.
          </div>
        </section>
      ) : (
        <div class={`kanban ${discarded ? "with-discarded" : ""}`}>
          {stages.map((stage) => {
            const list = orders.filter((o) =>
              stage.statuses.includes(o.status),
            );
            return (
              <section class="kanban-column" key={stage.name}>
                <div class="kanban-heading">
                  <span style={{ background: stage.color }} />
                  <h3>{stage.name}</h3>
                  <b>{list.length}</b>
                </div>
                {list.map((o) => (
                  <OrderCard key={o.id} order={o} onOrder={onOrder} />
                ))}
                {list.length === 0 && (
                  <div class="column-empty">Nothing here.</div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function OrderCard({
  order,
  onOrder,
}: {
  order: Order;
  onOrder: (o: Order) => void;
}) {
  const delivery = deliveryState(order);
  return (
    <button class="order-card" onClick={() => onOrder(order)}>
      <div>
        <span class="mono">
          {order.id}
          {order.ticket !== null && ` · ticket #${order.ticket}`}
        </span>
        <span class={`status-chip ${order.blocked ? "blocked" : order.status}`}>
          {order.blocked ? "Blocked" : orderStatus[order.status]}
        </span>
      </div>
      <h3>{order.title}</h3>
      {order.blocked && <span class="order-blocked">{order.blocked}</span>}
      {order.question && (
        <span class="dependency">
          <Icon name="help" />
          The worker is asking
        </span>
      )}
      {order.status === "signed" &&
        order.waitingOn.length > 0 &&
        !order.blocked && (
          <span class="dependency">
            <Icon name="link" />
            Waiting for {order.waitingOn.join(", ")}
          </span>
        )}
      {delivery && <span class="order-delivery">{delivery}</span>}
      <footer>
        <span>{order.worker ?? "developer"}</span>
        <span>{usd(order.spentUsd)}</span>
      </footer>
      {order.ready && order.status === "in_review" && (
        <span class="ready-mark">
          <Icon name="check" />
          Ready to merge
        </span>
      )}
    </button>
  );
}

const KIND_LABEL: Record<Agent["kind"], string> = {
  manager: "Manager",
  worker: "Worker",
  advisor: "Advisor",
};

const TEAM_ACTION = { hire: "Hire", dismiss: "Dismiss", refocus: "Refocus" };

const NOT_REPORTED = "not reported";

const tokensInOut = (usage: TokenUsage | null) =>
  usage === null
    ? NOT_REPORTED
    : `${tokenCount(usage.inputTokens)} in · ${tokenCount(usage.outputTokens)} out`;

const reportedSpend = (spentUsd: number | null) =>
  spentUsd === null ? NOT_REPORTED : usd(spentUsd);

export function AgentsView({
  project,
  appearance,
  settings = defaultStudioPreferences,
  onAgent,
  send,
  busy,
}: {
  project: Project;
  appearance: Appearance;
  settings?: StudioPreferences;
  onAgent: (a: Agent) => void;
  send: Send;
  busy: boolean;
}) {
  return (
    <>
      <div class="section-heading">
        <h2>One vision. Different talents.</h2>
        <span>{project.agents.length} AGENTS ON THIS PROJECT</span>
      </div>
      <div class="people-grid">
        {project.agents.map((a) => {
          const visual = studioAgentAppearance(
            project.id,
            a,
            appearance,
            settings,
          );
          const runId =
            a.status === "working" || a.status === "queued" ? a.runId : null;
          const lastFailure =
            a.status === "error"
              ? project.runs.find(
                  (run) => run.role === a.id && run.outcome === "failed",
                )?.failure
              : undefined;
          return (
            <article class="person-card" key={a.id}>
              <div class="person-card-head">
                <AvatarCanvas avatar={visual.avatar} name={visual.name} large />
                <div>
                  <span class={`status-chip ${a.status}`}>
                    {agentStatus[a.status]}
                    {a.queuePosition !== null && ` · number ${a.queuePosition}`}
                  </span>
                  <h3>{visual.name}</h3>
                  {a.role !== visual.name && <p>{a.role}</p>}
                </div>
              </div>
              {lastFailure && (
                <p class="agent-error" title={lastFailure.message}>
                  {lastFailure.message}
                </p>
              )}
              <div class="agent-runtime">
                <span>
                  <Icon name="code" />
                  {a.engine}
                </span>
                <span>{a.model ?? "default model"}</span>
              </div>
              <div class="person-stats">
                <span>
                  Kind
                  <strong>{KIND_LABEL[a.kind]}</strong>
                </span>
                <span>
                  Current order<strong>{a.orderId ?? "None"}</strong>
                </span>
              </div>
              {a.runs > 0 && (
                <div class="person-stats agent-totals">
                  <span>
                    Runs<strong>{a.runs}</strong>
                  </span>
                  <span>
                    Spent<strong>{reportedSpend(a.spentUsd)}</strong>
                  </span>
                  <span>
                    Tokens<strong>{tokensInOut(a.usage)}</strong>
                  </span>
                </div>
              )}
              {runId !== null && (
                <button
                  class="danger-button agent-stop"
                  disabled={busy}
                  onClick={() =>
                    void send({ name: "stop-run", payload: { runId } })
                  }
                >
                  <Icon name="stop" />
                  Stop
                </button>
              )}
              <button class="secondary-button" onClick={() => onAgent(a)}>
                <Icon name="edit" />
                Customize avatar
              </button>
            </article>
          );
        })}
      </div>
      {project.teamChanges.length > 0 && (
        <section class="panel team-proposals">
          <div class="panel-heading">
            <span class="panel-title">
              <Icon name="shield" />
              The team changes with your signature
            </span>
            <span class="pill">{project.teamChanges.length} TO SIGN</span>
          </div>
          {project.teamChanges.map((change) => (
            <div class="team-proposal" key={change.id}>
              <div>
                <h3>
                  {TEAM_ACTION[change.action]} {change.role}
                </h3>
                <p>{change.reason}</p>
                {change.focus && <p>New focus: {change.focus}</p>}
              </div>
              <div class="proposal-actions">
                <button
                  class="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void send({
                      name: "discard-team-change",
                      payload: { changeId: change.id },
                    })
                  }
                >
                  Discard
                </button>
                <button
                  class="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void send({
                      name: "sign-team-change",
                      payload: { changeId: change.id },
                    })
                  }
                >
                  Sign
                  <Icon name="check" />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {project.hireable.length > 0 && (
        <section class="panel hireable">
          <div class="panel-heading">
            <span class="panel-title">
              <Icon name="team" />
              Could be hired
            </span>
          </div>
          {project.hireable.map((role) => (
            <div class="team-proposal" key={role.name}>
              <div>
                <h3>{role.name}</h3>
                <p>{role.description}</p>
              </div>
            </div>
          ))}
        </section>
      )}
      <p class="view-note">
        <Icon name="shield" />
        Role, engine and model come from the team file; hiring goes through the
        Manager and your signature. The avatar is only how an agent looks here.
      </p>
    </>
  );
}

export function UsageView({
  project,
  costs,
}: {
  project: Project;
  costs: Snapshot["costs"];
}) {
  const ratio =
    costs.cap === null ? null : Math.min(100, (costs.today / costs.cap) * 100);
  const spenders = project.orders.filter((o) => o.spentUsd > 0);
  const active = project.agents.filter((a) => a.runs > 0);
  const roleName = (role: string) =>
    project.agents.find((a) => a.id === role)?.name ?? role;
  const [tab, setTab] = useState<"orders" | "agents" | "runs">("orders");
  return (
    <>
      <div class="usage-top">
        <section class="panel budget-card">
          <div class="panel-heading">
            <span class="panel-title">Today, the whole shop</span>
            <span class="pill">USD · UTC DAY</span>
          </div>
          <div class="budget-number">
            {usd(costs.today)}
            {costs.cap !== null && <small> / {usd(costs.cap)}</small>}
          </div>
          {ratio !== null && (
            <div class="progress-track">
              <div style={{ width: `${ratio}%`, background: "var(--mint)" }} />
            </div>
          )}
          <p>
            {ratio === null
              ? "No daily cap is set."
              : `${ratio.toFixed(0)}% of the daily cap.`}
          </p>
          <SpendChart days={costs.days} />
          <div class="budget-total">
            <span>Shop total</span>
            <strong>{usd(costs.total)}</strong>
          </div>
        </section>
        <section class="panel budget-card">
          <div class="panel-heading">
            <span class="panel-title">This project</span>
            <span class="pill">USD · ALL TIME</span>
          </div>
          <div class="budget-number">{usd(project.spentUsd)}</div>
          <p>Everything the agents spent on {project.name}.</p>
          {project.tokens === null ? (
            <div class="budget-total">
              <span>The engines have not reported token usage yet.</span>
            </div>
          ) : (
            <>
              <div class="budget-total">
                <span>Input tokens</span>
                <strong>{tokenCount(project.tokens.inputTokens)}</strong>
              </div>
              <div class="budget-total token-detail">
                <span>of which cached</span>
                <strong>
                  {project.tokens.cachedInputTokens === null
                    ? NOT_REPORTED
                    : tokenCount(project.tokens.cachedInputTokens)}
                </strong>
              </div>
              <div class="budget-total">
                <span>Output tokens</span>
                <strong>{tokenCount(project.tokens.outputTokens)}</strong>
              </div>
            </>
          )}
        </section>
      </div>
      <section class="panel cost-table">
        <div class="cost-tabs" role="tablist" aria-label="Where the money went">
          {(
            [
              ["orders", "Per work order", spenders.length],
              ["agents", "Per agent", active.length],
              ["runs", "Run history", project.runs.length],
            ] as const
          ).map(([id, title, count]) => (
            <button
              role="tab"
              id={`cost-tab-${id}`}
              aria-controls="cost-tabpanel"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              key={id}
            >
              {title}
              <span>{count}</span>
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="cost-tabpanel"
          aria-labelledby={`cost-tab-${tab}`}
        >
          {tab === "orders" && (
            <>
              {spenders.length > 0 ? (
                <div class="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>ORDER</th>
                        <th>STATUS</th>
                        <th>WORKER</th>
                        <th>USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spenders.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <strong>{o.title}</strong>
                            <small>{o.id}</small>
                          </td>
                          <td>
                            <span class={`status-chip ${o.status}`}>
                              {orderStatus[o.status]}
                            </span>
                          </td>
                          <td>{o.worker ?? "developer"}</td>
                          <td>{usd(o.spentUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div class="empty-state">
                  No work order has spent anything yet.
                </div>
              )}
            </>
          )}
          {tab === "agents" && (
            <>
              {active.length > 0 ? (
                <div class="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>AGENT</th>
                        <th>RUNS</th>
                        <th>TOKENS IN</th>
                        <th>CACHED</th>
                        <th>TOKENS OUT</th>
                        <th>USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <strong>{a.name}</strong>
                            <small>{a.engine}</small>
                          </td>
                          <td>{a.runs}</td>
                          <td>
                            {a.usage
                              ? tokenCount(a.usage.inputTokens)
                              : NOT_REPORTED}
                          </td>
                          <td>
                            {a.usage?.cachedInputTokens == null
                              ? NOT_REPORTED
                              : tokenCount(a.usage.cachedInputTokens)}
                          </td>
                          <td>
                            {a.usage
                              ? tokenCount(a.usage.outputTokens)
                              : NOT_REPORTED}
                          </td>
                          <td>{reportedSpend(a.spentUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div class="empty-state">
                  No agent has run on this project yet.
                </div>
              )}
            </>
          )}
          {tab === "runs" && (
            <>
              {project.runs.length > 0 ? (
                <div class="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>FINISHED</th>
                        <th>AGENT</th>
                        <th>ENGINE</th>
                        <th>OUTCOME</th>
                        <th>TURNS</th>
                        <th>TOKENS</th>
                        <th>ORDER</th>
                        <th>USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.runs.map((run) => (
                        <RunRow
                          key={run.runId}
                          run={run}
                          role={roleName(run.role)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div class="empty-state">
                  No run has finished on this project yet.
                </div>
              )}
            </>
          )}
        </div>
      </section>
      <p class="view-note">
        <Icon name="help" />
        Cost as reported by the CLIs. It is not a subscription invoice.
      </p>
    </>
  );
}

const monthDay = (day: string) =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function SpendChart({ days }: { days: Snapshot["costs"]["days"] }) {
  if (days.length < 2) return null;
  const tallest = Math.max(...days.map((entry) => entry.usd));
  return (
    <figure class="spend-chart">
      <ol aria-label={`Spent per day, last ${days.length} days`}>
        {days.map((entry, index) => (
          <li
            key={entry.day}
            class={index === days.length - 1 ? "today" : ""}
            title={`${monthDay(entry.day)} · ${usd(entry.usd)}`}
            aria-label={`${monthDay(entry.day)}: ${usd(entry.usd)}`}
          >
            <span
              style={{
                height:
                  tallest === 0 ? "0%" : `${(entry.usd / tallest) * 100}%`,
              }}
            />
          </li>
        ))}
      </ol>
      <figcaption>
        <span>{monthDay(days[0]!.day)}</span>
        <span>
          {tallest === 0
            ? "Nothing spent in these days"
            : `Tallest day ${usd(tallest)}`}
        </span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}

function RunRow({ run, role }: { run: Run; role: string }) {
  return (
    <tr>
      <td>{run.finishedAt ? dayTime(run.finishedAt) : "—"}</td>
      <td>{role}</td>
      <td>
        {run.engine}
        <small>{run.model ?? "default model"}</small>
      </td>
      <td>
        {run.outcome && (
          <span class={`status-chip ${run.outcome}`}>
            {runOutcome[run.outcome]}
          </span>
        )}
        {run.outcome === "failed" && run.failure && (
          <small class="run-failure" title={run.failure.message}>
            {run.failure.message}
          </small>
        )}
      </td>
      <td>{run.turns ?? "—"}</td>
      <td>{tokensInOut(run.usage)}</td>
      <td>{run.orderId ?? "—"}</td>
      <td>{reportedSpend(run.costUsd)}</td>
    </tr>
  );
}

const MAX_NAME = 60;
const MAX_DESCRIPTION = 280;

function ProfileCard({
  project,
  send,
  busy,
}: {
  project: Project;
  send: Send;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
  } | null>(null);
  const save = async () => {
    if (draft === null) return;
    const name = draft.name.trim();
    const description = draft.description.trim();
    const sent = await send({
      name: "describe-project",
      payload: {
        project: project.id,
        ...(name !== project.name && { name: name || null }),
        ...(description !== (project.description ?? "") && {
          description: description || null,
        }),
      },
    });
    if (sent) setDraft(null);
  };
  return (
    <section class="panel profile-card">
      <div class="panel-heading">
        <span class="panel-title">Project</span>
        {draft === null && (
          <button
            class="text-button"
            onClick={() =>
              setDraft({
                name: project.name,
                description: project.description ?? "",
              })
            }
          >
            <Icon name="edit" />
            Edit
          </button>
        )}
      </div>
      {draft === null ? (
        <>
          <h3>{project.name}</h3>
          <p>{project.description ?? "No description yet."}</p>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label class="form-label" for="profile-name">
            NAME
          </label>
          <input
            id="profile-name"
            type="text"
            maxLength={MAX_NAME}
            value={draft.name}
            onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
          />
          <label class="form-label" for="profile-description">
            DESCRIPTION · {draft.description.length}/{MAX_DESCRIPTION}
          </label>
          <textarea
            id="profile-description"
            maxLength={MAX_DESCRIPTION}
            value={draft.description}
            onInput={(e) =>
              setDraft({ ...draft, description: e.currentTarget.value })
            }
          />
          <div class="proposal-actions">
            <button
              type="button"
              class="secondary-button"
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
            <button type="submit" class="primary-button" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function PauseCard({
  project,
  send,
  busy,
}: {
  project: Project;
  send: Send;
  busy: boolean;
}) {
  const paused = project.paused;
  return (
    <section class="panel pause-card">
      <div class="panel-heading">
        <span class="panel-title">This project's work</span>
        {paused && <span class="pill">PAUSED</span>}
      </div>
      {paused && (
        <p class="pause-reason">
          {paused.reason}
          <small>Paused since {dayTime(paused.since)}</small>
        </p>
      )}
      <p>
        While paused, this project's queued runs wait and the running ones
        finish. Other projects go on.
      </p>
      <button
        class="secondary-button"
        disabled={busy}
        onClick={() =>
          void send({
            name: paused ? "resume-project" : "pause-project",
            payload: { project: project.id },
          })
        }
      >
        <Icon name={paused ? "play" : "pause"} />
        {paused ? "Resume this project" : "Pause this project"}
      </button>
    </section>
  );
}

const FINDING_ICON: Record<Finding["level"], string> = {
  ok: "check",
  warn: "help",
  fail: "close",
};

export function ContextView({
  project,
  readiness,
  send,
  busy,
}: {
  project: Project;
  readiness: readonly Finding[];
  send: Send;
  busy: boolean;
}) {
  const repoUrl = /^[\w.-]+\/[\w.-]+$/.test(project.repo)
    ? `https://github.com/${project.repo}`
    : null;
  return (
    <div class="context-grid">
      <div class="context-main">
        {project.briefingChanges.map((change) => (
          <section class="panel team-proposals" key={change.id}>
            <div class="panel-heading">
              <span class="panel-title">
                <Icon name="shield" />
                Proposed: new briefing
              </span>
              <span class="pill">TO SIGN</span>
            </div>
            <div class="briefing-change">
              <p>{change.reason}</p>
              <pre class="briefing-text">{change.text}</pre>
              <div class="proposal-actions">
                <button
                  class="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void send({
                      name: "discard-briefing-change",
                      payload: { changeId: change.id },
                    })
                  }
                >
                  Discard
                </button>
                <button
                  class="primary-button"
                  disabled={busy}
                  onClick={() =>
                    void send({
                      name: "sign-briefing-change",
                      payload: { changeId: change.id },
                    })
                  }
                >
                  Sign
                  <Icon name="check" />
                </button>
              </div>
            </div>
          </section>
        ))}
        <section class="panel vision-card">
          <div class="panel-heading">
            <span class="panel-title">
              <Icon name="star" />
              The briefing every agent reads
            </span>
          </div>
          <div class="vision-content">
            <span class="eyebrow">
              {project.briefing === null ? "NO BRIEFING YET" : "SIGNED BY YOU"}
            </span>
            <h2>{project.name}</h2>
            <p>
              {project.briefing ??
                "No briefing has been signed for this project yet. Ask the Manager to propose one; it takes effect when you sign it."}
            </p>
          </div>
          <div class="context-principle">
            <Icon name="shield" />
            <span>
              The LLM proposes. The code validates. The director decides.
            </span>
          </div>
        </section>
      </div>
      <div class="context-side">
        <ProfileCard project={project} send={send} busy={busy} />
        <PauseCard project={project} send={send} busy={busy} />
        <section class="panel repository-card">
          <div class="panel-heading">
            <span class="panel-title">Repository</span>
            <Icon name="code" />
          </div>
          <h3>{project.repo}</h3>
          {repoUrl && (
            <a
              class="secondary-button"
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open on GitHub
              <Icon name="arrow" />
            </a>
          )}
        </section>
        <section class="panel context-files">
          <div class="panel-heading">
            <span class="panel-title">Setup</span>
            <button
              class="text-button"
              disabled={busy}
              onClick={() => void send({ name: "recheck", payload: {} })}
            >
              Check again
            </button>
          </div>
          {readiness.length === 0 && (
            <div class="column-empty">No setup checks have run.</div>
          )}
          {readiness.map((finding) => (
            <div class={`finding ${finding.level}`} key={finding.check}>
              <Icon name={FINDING_ICON[finding.level]} />
              <span>
                {finding.check}
                <small>{finding.detail}</small>
                {finding.fix && <em>{finding.fix}</em>}
              </span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

const ACTIVITY_ICON: Record<Activity["kind"], string> = {
  order: "orders",
  delivery: "link",
  run: "code",
  advice: "chat",
};

export function ActivityView({
  project,
  appearance,
  settings,
  onAgent,
  onOrder,
}: {
  project: Project;
  appearance: Appearance;
  settings: StudioPreferences;
  onAgent: (agent: Agent) => void;
  onOrder: (order: Order) => void;
}) {
  const [filter, setFilter] = useState<Activity["kind"] | "all">("all");
  const [author, setAuthor] = useState("all");
  const authors = [
    ...new Set(project.activity.flatMap((a) => (a.by ? [a.by] : []))),
  ];
  const agentOf = (id: string | null) =>
    project.agents.find((agent) => agent.id === id);
  const nameOf = (id: string) =>
    id === "director" ? "you" : (agentOf(id)?.name ?? id.replace(/[_-]/g, " "));
  const activities = project.activity.filter(
    (a) =>
      (filter === "all" || a.kind === filter) &&
      (author === "all" || a.by === author),
  );
  return (
    <section class="panel timeline-panel">
      <div class="panel-heading">
        <span class="panel-title">Work leaves a trace.</span>
        <div class="timeline-filters">
          <select
            aria-label="Filter the logbook by who did it"
            value={author}
            onChange={(e) => setAuthor(e.currentTarget.value)}
          >
            <option value="all">Everyone</option>
            {authors.map((id) => (
              <option value={id} key={id}>
                {nameOf(id)}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter the logbook"
            value={filter}
            onChange={(e) =>
              setFilter(e.currentTarget.value as Activity["kind"] | "all")
            }
          >
            <option value="all">Everything</option>
            <option value="order">Work orders</option>
            <option value="delivery">Delivery</option>
            <option value="run">Runs</option>
            <option value="advice">Advice</option>
          </select>
        </div>
      </div>
      {activities.map((a) => {
        const agent = agentOf(a.by);
        const order = project.orders.find((o) => o.id === a.orderId);
        return (
          <article class="timeline-entry" key={a.sequence}>
            {agent ? (
              <button
                class="timeline-author"
                onClick={() => onAgent(agent)}
                title={`Open ${nameOf(agent.id)}'s desk`}
              >
                <AvatarCanvas
                  {...studioAgentAppearance(
                    project.id,
                    agent,
                    appearance,
                    settings,
                  )}
                />
              </button>
            ) : (
              <span class="timeline-icon">
                <Icon name={ACTIVITY_ICON[a.kind]} />
              </span>
            )}
            <time title={dayTime(a.at)}>{ago(a.at)}</time>
            <div>
              {a.url ? (
                <p>
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.text}
                  </a>
                </p>
              ) : (
                <RichText text={a.text} />
              )}
              <small>
                {dayTime(a.at)} · {a.kind}
                {a.by && " · by "}
                {a.by &&
                  (agent ? (
                    <button onClick={() => onAgent(agent)}>
                      {nameOf(a.by)}
                    </button>
                  ) : (
                    nameOf(a.by)
                  ))}
                {a.orderId && " · "}
                {order ? (
                  <button onClick={() => onOrder(order)} title={order.title}>
                    {order.id} · {order.title}
                  </button>
                ) : (
                  a.orderId
                )}
              </small>
            </div>
            <span class="event-sequence">#{a.sequence}</span>
          </article>
        );
      })}
      {activities.length === 0 && (
        <div class="empty-state">
          {project.activity.length === 0
            ? "Nothing has happened yet."
            : "Nothing of this kind yet."}
        </div>
      )}
    </section>
  );
}
