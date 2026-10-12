import { useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type {
  Answered,
  BriefingChange,
  Command,
  Decision,
  InboxItem,
  Order,
  Project,
  Send,
  TeamChange,
} from "../contracts";
import { Icon } from "./Icon";
import { RichLine } from "./RichText";
import { plansToSign } from "../application/plans";
import { unblocking } from "./order-actions";
import { ago, dayTime } from "./format";
import "./decisions.css";

const TEAM_ACTION: Record<TeamChange["action"], string> = {
  hire: "Hire",
  dismiss: "Dismiss",
  refocus: "Refocus",
};

const ASKED: Record<Exclude<Answered["kind"], "worker_question">, string> = {
  manager_question: "The Manager asked",
  ticket_doubt: "The Manager had a doubt about a ticket",
};

const moment = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

function AnsweredQuestion({
  entry,
  label,
  order,
  onOrder,
}: {
  entry: Answered;
  label: string;
  order: Order | undefined;
  onOrder: (order: Order) => void;
}) {
  return (
    <article
      class={`decision-question answered ${entry.kind.replace("_", "-")}`}
    >
      <div class="question-meta">
        <span>
          <Icon name={entry.kind === "ticket_doubt" ? "shield" : "help"} />
          {label}
        </span>
        {order ? (
          <button
            type="button"
            class="question-order"
            onClick={() => onOrder(order)}
          >
            {order.id}
          </button>
        ) : entry.kind === "worker_question" && entry.orderId !== null ? (
          <span>{entry.orderId}</span>
        ) : (
          entry.ticket !== null && <span>ticket #{entry.ticket}</span>
        )}
      </div>
      <h3>{entry.question}</h3>
      <div class="question-answer">
        <span>Your call</span>
        <p>{entry.answer}</p>
      </div>
      <p class="question-author">
        {entry.askedAt && (
          <>
            Asked <time dateTime={entry.askedAt}>{moment(entry.askedAt)}</time>
            {" · "}
          </>
        )}
        Answered{" "}
        <time dateTime={entry.answeredAt}>{moment(entry.answeredAt)}</time> ·{" "}
        {ago(entry.answeredAt)}
      </p>
    </article>
  );
}

function Question({
  kind,
  label,
  question,
  options,
  askedAt,
  ticket,
  order,
  onOrder,
  answerWith,
  send,
  busy,
}: {
  kind: InboxItem["kind"];
  label: string;
  question: string;
  options: readonly string[];
  askedAt: string;
  ticket: number | null;
  order?: Order | undefined;
  onOrder?: ((order: Order) => void) | undefined;
  answerWith: (answer: string) => Command;
  send: Send;
  busy: boolean;
}) {
  const [answer, setAnswer] = useState("");
  return (
    <article class={`decision-question ${kind.replace("_", "-")}`}>
      <div class="question-meta">
        <span>
          <Icon name={kind === "ticket_doubt" ? "shield" : "help"} />
          {label}
        </span>
        {order && onOrder ? (
          <button
            type="button"
            class="question-order"
            onClick={() => onOrder(order)}
          >
            {order.id}
          </button>
        ) : (
          ticket !== null && <span>ticket #{ticket}</span>
        )}
      </div>
      {askedAt && (
        <p class="question-author" title={dayTime(askedAt)}>
          Asked {ago(askedAt)}
        </p>
      )}
      <h3>{question}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = answer.trim();
          if (busy || !text) return;
          void send(answerWith(text)).then((ok) => {
            if (ok) setAnswer("");
          });
        }}
      >
        {options.length > 0 && (
          <div class="decision-options" aria-label="Proposed options">
            {options.map((option) => (
              <button
                type="button"
                key={option}
                disabled={busy}
                aria-pressed={answer === option}
                onClick={() => setAnswer(option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}
        <label class="answer-label">
          Your call
          <textarea
            rows={3}
            required
            maxLength={4000}
            placeholder={
              options.length > 0
                ? "Pick an option or explain your decision…"
                : "Explain your decision…"
            }
            value={answer}
            onInput={(event) => setAnswer(event.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          class="primary-button answer-submit"
          disabled={busy || !answer.trim()}
        >
          Send answer
          <Icon name="arrow" />
        </button>
      </form>
    </article>
  );
}

export function DecisionReply({
  decision,
  send,
  busy,
}: {
  decision: Decision;
  send: Send;
  busy: boolean;
}) {
  return (
    <Question
      kind={decision.ticket === null ? "manager_question" : "ticket_doubt"}
      label={
        decision.ticket === null
          ? "The Manager asks"
          : "The Manager has a doubt about a ticket"
      }
      question={decision.question}
      options={decision.options}
      askedAt={decision.askedAt}
      ticket={decision.ticket}
      answerWith={(answer) => ({
        name: "answer-decision",
        payload: { decisionId: decision.id, answer },
      })}
      send={send}
      busy={busy}
    />
  );
}

function Proposal({
  eyebrow,
  title,
  signing,
  signLabel = "Sign",
  discarding,
  send,
  busy,
  children,
}: {
  eyebrow: string;
  title: string;
  signing: Command;
  signLabel?: string;
  discarding?: Command;
  send: Send;
  busy: boolean;
  children: ComponentChildren;
}) {
  return (
    <article class="inbox-proposal">
      <span class="eyebrow">{eyebrow}</span>
      <h3>{title}</h3>
      {children}
      <div class="proposal-actions">
        <button
          type="button"
          class="primary-button"
          disabled={busy}
          onClick={() => void send(signing)}
        >
          {signLabel}
        </button>
        {discarding && (
          <button
            type="button"
            class="danger-button"
            disabled={busy}
            onClick={() => void send(discarding)}
          >
            Discard
          </button>
        )}
      </div>
    </article>
  );
}

export function TeamChangeProposal({
  change,
  send,
  busy,
  onTeam,
}: {
  change: TeamChange;
  send: Send;
  busy: boolean;
  onTeam?: () => void;
}) {
  const payload = { changeId: change.id };
  return (
    <Proposal
      eyebrow="TEAM CHANGE"
      title={`${TEAM_ACTION[change.action]} ${change.role}`}
      signing={{ name: "sign-team-change", payload }}
      discarding={{ name: "discard-team-change", payload }}
      send={send}
      busy={busy}
    >
      <p>{change.reason}</p>
      {change.focus && <p>New focus: {change.focus}</p>}
      {onTeam && (
        <button type="button" class="proposal-link" onClick={onTeam}>
          See the team
          <Icon name="arrow" />
        </button>
      )}
    </Proposal>
  );
}

export function BriefingChangeProposal({
  change,
  send,
  busy,
}: {
  change: BriefingChange;
  send: Send;
  busy: boolean;
}) {
  const payload = { changeId: change.id };
  return (
    <Proposal
      eyebrow="BRIEFING CHANGE"
      title="New briefing"
      signing={{ name: "sign-briefing-change", payload }}
      discarding={{ name: "discard-briefing-change", payload }}
      send={send}
      busy={busy}
    >
      <p>{change.reason}</p>
      <pre class="proposal-briefing">{change.text}</pre>
    </Proposal>
  );
}

export function DecisionInbox({
  project,
  send,
  busy,
  onManager,
  onOrder,
  onTeam,
  collapsed = false,
  onToggle,
}: {
  project: Project;
  send: Send;
  busy: boolean;
  onManager: () => void;
  onOrder: (order: Order) => void;
  onTeam: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const Heading = onToggle ? "button" : "div";
  const proposals = project.orders.filter(
    (order) => order.status === "awaiting_signature",
  );
  const signatures =
    proposals.length +
    project.teamChanges.length +
    project.briefingChanges.length;
  const blocked = project.orders.filter((order) => order.blocked !== null);
  const waiting = [
    ["questions", "to decide", project.inbox.length],
    ["signatures", "to sign", signatures],
    ["blocked", "blocked", blocked.length],
  ] as const;
  // Until the director picks a tab the desk follows what waits, and only leaves a tab once it is empty.
  const [chosen, setTab] = useState<
    "questions" | "signatures" | "blocked" | "answered" | null
  >(null);
  const followed = useRef<(typeof waiting)[number][0]>("questions");
  if (!waiting.some(([id, , count]) => id === followed.current && count > 0))
    followed.current =
      waiting.find(([, , count]) => count > 0)?.[0] ?? followed.current;
  const tab = chosen ?? followed.current;
  const summary = waiting
    .filter(([, , count]) => count > 0)
    .map(([, name, count]) => `${count} ${name}`)
    .join(" · ");
  const tabId = `director-${project.id}`;
  const askerName = (item: { from: string }) =>
    project.agents.find((agent) => agent.id === item.from)?.name ?? item.from;
  return (
    <section
      class={`director-inbox ${collapsed ? "collapsed" : ""}`}
      aria-label="Decision desk"
    >
      <Heading
        class="inbox-heading"
        onClick={onToggle}
        aria-expanded={onToggle ? !collapsed : undefined}
      >
        <span class="director-icon">
          <Icon name="chat" />
        </span>
        <div>
          <span class="eyebrow">
            {summary ? summary.toUpperCase() : "YOUR SEAT IN THE STUDIO"}
          </span>
          <h2>Decision desk</h2>
        </div>
        <span class={`inbox-counter ${project.needsYou > 0 ? "waiting" : ""}`}>
          {project.needsYou}
        </span>
        {onToggle && <Icon name="chevron" />}
      </Heading>
      <p class="inbox-intro">
        Questions, doubts and proposals. Your call gets the team moving.
      </p>
      <div class="inbox-tabs" role="tablist" aria-label="Waiting for you">
        {(
          [
            ["questions", "To decide", project.inbox.length],
            ["signatures", "To sign", signatures],
            ["blocked", "Blocked", blocked.length],
            ["answered", "Answered", project.answered.length],
          ] as const
        ).map(([id, title, count]) => (
          <button
            role="tab"
            id={`${tabId}-${id}`}
            aria-controls={`${tabId}-${id}-panel`}
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
        class="director-tabpanel"
        role="tabpanel"
        id={`${tabId}-questions-panel`}
        aria-labelledby={`${tabId}-questions`}
        hidden={tab !== "questions"}
      >
        {project.inbox.map((item) => {
          const orderId = item.orderId;
          return item.kind === "worker_question" && orderId !== null ? (
            <Question
              key={item.id}
              kind={item.kind}
              label={`${askerName(item)} asks`}
              question={item.question}
              options={item.options}
              askedAt={item.askedAt}
              ticket={item.ticket}
              order={project.orders.find((order) => order.id === orderId)}
              onOrder={onOrder}
              answerWith={(answer) => ({
                name: "answer-question",
                payload: { orderId, answer },
              })}
              send={send}
              busy={busy}
            />
          ) : (
            <Question
              key={item.id}
              kind={item.kind}
              label={
                item.kind === "ticket_doubt"
                  ? "The Manager has a doubt about a ticket"
                  : "The Manager asks"
              }
              question={item.question}
              options={item.options}
              askedAt={item.askedAt}
              ticket={item.ticket}
              answerWith={(answer) => ({
                name: "answer-decision",
                payload: { decisionId: item.id, answer },
              })}
              send={send}
              busy={busy}
            />
          );
        })}
        {project.inbox.length === 0 && (
          <div class="inbox-empty">
            <Icon name="check" />
            <h3>The team has what it needs.</h3>
            <p>New questions will land here.</p>
          </div>
        )}
      </div>
      <div
        class="director-tabpanel"
        role="tabpanel"
        id={`${tabId}-signatures-panel`}
        aria-labelledby={`${tabId}-signatures`}
        hidden={tab !== "signatures"}
      >
        {plansToSign(project.orders).map((plan) => {
          const first = plan[0]!;
          return (
            <Proposal
              key={first.plan}
              eyebrow={
                plan.length > 1
                  ? `PLAN · ${plan.length} WORK ORDERS`
                  : `WORK ORDER · ${first.id}`
              }
              title={plan.length > 1 ? "In this sequence" : first.title}
              signing={{ name: "sign-plan", payload: { plan: first.plan } }}
              signLabel={plan.length > 1 ? "Sign the plan" : "Sign"}
              {...(plan.length === 1 && {
                discarding: {
                  name: "discard-order",
                  payload: { orderId: first.id },
                },
              })}
              send={send}
              busy={busy}
            >
              <ol class="proposal-plan">
                {plan.map((order) => (
                  <li key={order.id}>
                    {plan.length > 1 && <strong>{order.title}</strong>}
                    <p>
                      <RichLine text={order.summary} />
                    </p>
                    <button
                      type="button"
                      class="proposal-link"
                      onClick={() => onOrder(order)}
                    >
                      {plan.length > 1 ? `${order.id} · open the brief` : "Open detail"}
                      <Icon name="arrow" />
                    </button>
                  </li>
                ))}
              </ol>
            </Proposal>
          );
        })}
        {project.teamChanges.map((change) => (
          <TeamChangeProposal
            key={change.id}
            change={change}
            send={send}
            busy={busy}
            onTeam={onTeam}
          />
        ))}
        {project.briefingChanges.map((change) => (
          <BriefingChangeProposal
            key={change.id}
            change={change}
            send={send}
            busy={busy}
          />
        ))}
        {signatures === 0 && (
          <div class="inbox-empty">
            <Icon name="check" />
            <h3>Nothing to sign.</h3>
            <p>
              Work orders, team changes and briefing changes that need your
              signature will land here.
            </p>
          </div>
        )}
      </div>
      <div
        class="director-tabpanel"
        role="tabpanel"
        id={`${tabId}-blocked-panel`}
        aria-labelledby={`${tabId}-blocked`}
        hidden={tab !== "blocked"}
      >
        {blocked.map((order) => {
          const unblock = unblocking(order);
          return (
            <article class="inbox-proposal" key={order.id}>
              <span class="eyebrow">{`BLOCKED · ${order.id}`}</span>
              <h3>{order.title}</h3>
              <p>{order.blocked}</p>
              {unblock && (
                <div class="proposal-actions">
                  <button
                    type="button"
                    class="primary-button"
                    disabled={busy}
                    onClick={() => void send(unblock.command)}
                  >
                    {unblock.label}
                  </button>
                </div>
              )}
              <button
                type="button"
                class="proposal-link"
                onClick={() => onOrder(order)}
              >
                Open detail
                <Icon name="arrow" />
              </button>
            </article>
          );
        })}
        {blocked.length === 0 && (
          <div class="inbox-empty">
            <Icon name="check" />
            <h3>Nothing is blocked.</h3>
            <p>An order that cannot go on without you will land here.</p>
          </div>
        )}
      </div>
      <div
        class="director-tabpanel"
        role="tabpanel"
        id={`${tabId}-answered-panel`}
        aria-labelledby={`${tabId}-answered`}
        hidden={tab !== "answered"}
      >
        {project.answered.map((entry) => (
          <AnsweredQuestion
            key={entry.id}
            entry={entry}
            label={
              entry.kind === "worker_question"
                ? `${askerName(entry)} asked`
                : ASKED[entry.kind]
            }
            order={
              entry.kind === "worker_question"
                ? project.orders.find((order) => order.id === entry.orderId)
                : undefined
            }
            onOrder={onOrder}
          />
        ))}
        {project.answered.length === 0 && (
          <div class="inbox-empty">
            <Icon name="chat" />
            <h3>No answers yet.</h3>
            <p>Every question you answer is kept here.</p>
          </div>
        )}
      </div>
      <button class="inbox-manager" onClick={onManager}>
        Talk to the Manager
        <Icon name="arrow" />
      </button>
    </section>
  );
}
