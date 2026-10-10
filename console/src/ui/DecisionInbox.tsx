import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type {
  Command,
  Decision,
  InboxItem,
  Order,
  Project,
  Send,
  TeamChange,
} from "../contracts";
import { Icon } from "./Icon";
import { clock } from "./format";
import "./decisions.css";

const TEAM_ACTION: Record<TeamChange["action"], string> = {
  hire: "Hire",
  dismiss: "Dismiss",
  refocus: "Refocus",
};

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
      {askedAt && <p class="question-author">Asked at {clock(askedAt)}</p>}
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
  discarding,
  send,
  busy,
  children,
}: {
  eyebrow: string;
  title: string;
  signing: Command;
  discarding: Command;
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
          Sign
        </button>
        <button
          type="button"
          class="secondary-button"
          disabled={busy}
          onClick={() => void send(discarding)}
        >
          Discard
        </button>
      </div>
    </article>
  );
}

export function DecisionInbox({
  project,
  send,
  busy,
  onManager,
  onOrder,
  onTeam,
}: {
  project: Project;
  send: Send;
  busy: boolean;
  onManager: () => void;
  onOrder: (order: Order) => void;
  onTeam: () => void;
}) {
  const proposals = project.orders.filter(
    (order) => order.status === "awaiting_signature",
  );
  const signatures =
    proposals.length +
    project.teamChanges.length +
    project.briefingChanges.length;
  const [tab, setTab] = useState<"questions" | "signatures">(() =>
    project.inbox.length === 0 && signatures > 0 ? "signatures" : "questions",
  );
  const tabId = `director-${project.id}`;
  const askerName = (item: InboxItem) =>
    project.agents.find((agent) => agent.id === item.from)?.name ?? item.from;
  return (
    <section class="director-inbox" aria-label="Decision desk">
      <div class="inbox-heading">
        <span class="director-icon">
          <Icon name="chat" />
        </span>
        <div>
          <span class="eyebrow">YOUR SEAT IN THE STUDIO</span>
          <h2>Decision desk</h2>
        </div>
        <span class="inbox-counter">{project.inbox.length + signatures}</span>
      </div>
      <p class="inbox-intro">
        Questions, doubts and proposals. Your call gets the team moving.
      </p>
      <div class="inbox-tabs" role="tablist" aria-label="Waiting for you">
        {(
          [
            ["questions", "To decide", project.inbox.length],
            ["signatures", "To sign", signatures],
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
        {proposals.map((order) => (
          <Proposal
            key={order.id}
            eyebrow={`WORK ORDER · ${order.id}`}
            title={order.title}
            signing={{ name: "sign-order", payload: { orderId: order.id } }}
            discarding={{
              name: "discard-order",
              payload: { orderId: order.id },
            }}
            send={send}
            busy={busy}
          >
            <p>{order.objective}</p>
            <button
              type="button"
              class="proposal-link"
              onClick={() => onOrder(order)}
            >
              Open detail
              <Icon name="arrow" />
            </button>
          </Proposal>
        ))}
        {project.teamChanges.map((change) => (
          <Proposal
            key={change.id}
            eyebrow="TEAM CHANGE"
            title={`${TEAM_ACTION[change.action]} ${change.role}`}
            signing={{
              name: "sign-team-change",
              payload: { changeId: change.id },
            }}
            discarding={{
              name: "discard-team-change",
              payload: { changeId: change.id },
            }}
            send={send}
            busy={busy}
          >
            <p>{change.reason}</p>
            {change.focus && <p>New focus: {change.focus}</p>}
            <button type="button" class="proposal-link" onClick={onTeam}>
              See the team
              <Icon name="arrow" />
            </button>
          </Proposal>
        ))}
        {project.briefingChanges.map((change) => (
          <Proposal
            key={change.id}
            eyebrow="BRIEFING CHANGE"
            title="New briefing"
            signing={{
              name: "sign-briefing-change",
              payload: { changeId: change.id },
            }}
            discarding={{
              name: "discard-briefing-change",
              payload: { changeId: change.id },
            }}
            send={send}
            busy={busy}
          >
            <p>{change.reason}</p>
            <pre class="proposal-briefing">{change.text}</pre>
          </Proposal>
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
      <button class="inbox-manager" onClick={onManager}>
        Talk to the Manager
        <Icon name="arrow" />
      </button>
    </section>
  );
}
