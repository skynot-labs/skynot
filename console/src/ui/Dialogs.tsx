import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Decision, Message, Project, Send } from "../contracts";
import { Icon } from "./Icon";
import "./shell.css";
export { AvatarEditor } from "./AvatarEditor";

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow: string;
  children: ComponentChildren;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      class={wide ? "modal-wide" : ""}
      aria-labelledby="dialogTitle"
      onCancel={onClose}
      onClick={(event) => {
        const element = ref.current;
        if (!element || event.target !== element) return;
        const rect = element.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div class="modal-header">
        <div>
          <div class="eyebrow">{eyebrow}</div>
          <h2 id="dialogTitle">{title}</h2>
        </div>
        <button
          class="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function ManagerChat({
  project,
  send,
  busy,
}: {
  project: Project;
  send: Send;
  busy: boolean;
}) {
  const [message, setMessage] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const working = project.agents.some(
    (agent) =>
      agent.kind === "manager" &&
      (agent.status === "working" || agent.status === "queued"),
  );
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [project.chat, working]);
  async function submit(event: Event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setMessage("");
    const sent = await send({
      name: "send-message",
      payload: { text, project: project.id },
    });
    if (!sent) setMessage(text);
  }
  return (
    <>
      <div class="manager-project">
        <span class="tiny-led" />
        <span>{project.name}</span>
        <span class="muted">One Manager. All the context.</span>
      </div>
      <div class="chat-messages" ref={list}>
        {project.chat.map((entry) => (
          <ChatMessage
            key={entry.id}
            message={entry}
            project={project}
            send={send}
            busy={busy}
          />
        ))}
        {project.chat.length === 0 && (
          <div class="empty-state">
            Tell the Manager what you want built or fixed.
            <br />
            The team starts by understanding the intent.
          </div>
        )}
        {working && (
          <p class="chat-working" role="status">
            <span class="tiny-led" />
            The Manager is working on it…
          </p>
        )}
      </div>
      <form class="chat-compose" onSubmit={submit}>
        <textarea
          aria-label="Message to the Manager"
          maxLength={4000}
          rows={2}
          value={message}
          onInput={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
              void submit(event);
          }}
          placeholder="An idea, a bug, a question…"
        />
        <button
          class="primary-button"
          disabled={busy || !message.trim()}
          type="submit"
        >
          Send
          <Icon name="arrow" />
        </button>
      </form>
      <p class="form-note">
        The Manager can answer, ask or propose a work order. Signing it stays
        with you.
      </p>
    </>
  );
}

const authors: Record<Message["author"], string> = {
  director: "YOU · DIRECTOR",
  manager: "MANAGER",
  ticket: "TICKET",
};

function ChatMessage({
  message,
  project,
  send,
  busy,
}: {
  message: Message;
  project: Project;
  send: Send;
  busy: boolean;
}) {
  const order = message.orderId
    ? project.orders.find((candidate) => candidate.id === message.orderId)
    : undefined;
  const decision = message.decisionId
    ? project.decisions.find((candidate) => candidate.id === message.decisionId)
    : undefined;
  return (
    <article class={`chat-message ${message.author}`}>
      <span>{authors[message.author]}</span>
      <p>{order ? message.text.split("\n\n")[0] : message.text}</p>
      {order && <pre class="chat-card">{order.card}</pre>}
      {decision && <ChatQuestion decision={decision} send={send} busy={busy} />}
    </article>
  );
}

function ChatQuestion({
  decision,
  send,
  busy,
}: {
  decision: Decision;
  send: Send;
  busy: boolean;
}) {
  const [other, setOther] = useState("");
  const answer = (value: string) =>
    send({
      name: "answer-decision",
      payload: { decisionId: decision.id, answer: value },
    });
  return (
    <div class="chat-question">
      <p>{decision.question}</p>
      {decision.options.length > 0 && (
        <div class="decision-options" aria-label="Proposed options">
          {decision.options.map((option) => (
            <button
              type="button"
              key={option}
              disabled={busy}
              onClick={() => void answer(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <form
        class="chat-answer"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = other.trim();
          if (value && (await answer(value))) setOther("");
        }}
      >
        <input
          type="text"
          aria-label={`Your answer to: ${decision.question}`}
          maxLength={4000}
          value={other}
          placeholder="or answer in your own words"
          onInput={(event) => setOther(event.currentTarget.value)}
        />
        <button
          class="secondary-button"
          type="submit"
          disabled={busy || !other.trim()}
        >
          Answer
        </button>
      </form>
    </div>
  );
}
