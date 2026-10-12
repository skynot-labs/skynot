import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Decision, Message, Order, Project, Send } from "../contracts";
import { planOf } from "../application/plans";
import { orderStatus } from "./format";
import { Icon } from "./Icon";
import { RichLine, RichText } from "./RichText";
import { announceArrival } from "./arrival";
import "./shell.css";
export { AvatarEditor } from "./AvatarEditor";

export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  size = "normal",
}: {
  title: string;
  eyebrow: string;
  children: ComponentChildren;
  onClose: () => void;
  size?: "normal" | "wide" | "full";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const typed = useRef(false);
  const closeFromBackdrop = () => {
    if (!typed.current) onClose();
  };
  // A full panel opens beside the sidebar, which has to stay usable: showModal would make it inert.
  const beside = size === "full";
  useEffect(() => {
    const element = ref.current;
    announceArrival(element);
    if (!beside) {
      element?.showModal();
      return () => element?.close();
    }
    element?.show();
    element?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      element?.close();
    };
  }, []);
  return (
    <>
      {beside && <div class="panel-backdrop" onClick={closeFromBackdrop} />}
      <dialog
        ref={ref}
        tabIndex={-1}
        class={size === "normal" ? "" : `modal-${size}`}
        aria-labelledby="dialogTitle"
        onCancel={onClose}
        onInput={(event) => {
          if (
            event.target instanceof Element &&
            event.target.matches("textarea, input[type=text]")
          )
            typed.current = true;
        }}
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
            closeFromBackdrop();
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
    </>
  );
}

export function ManagerChat({
  project,
  send,
  busy,
  onOrder,
}: {
  project: Project;
  send: Send;
  busy: boolean;
  onOrder: (order: Order) => void;
}) {
  const [message, setMessage] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const manager = project.agents.find((agent) => agent.kind === "manager");
  const latest = project.chat.at(-1)?.decisionId;
  const buried = project.decisions.filter((decision) => decision.id !== latest);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [project.chat, manager?.status]);
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
      {buried.length > 0 && (
        <div class="chat-pinned" role="group" aria-label="Open questions">
          {buried.map((decision) => (
            <button
              type="button"
              key={decision.id}
              onClick={() =>
                document
                  .getElementById(`chat-${decision.id}`)
                  ?.scrollIntoView({ block: "center" })
              }
            >
              <span>WAITING FOR YOUR ANSWER</span>
              {decision.question}
            </button>
          ))}
        </div>
      )}
      <div class="chat-messages" ref={list}>
        {project.chat.map((entry) => (
          <ChatMessage
            key={entry.id}
            message={entry}
            project={project}
            send={send}
            busy={busy}
            onOrder={onOrder}
          />
        ))}
        {project.chat.length === 0 && (
          <div class="empty-state">
            Tell the Manager what you want built or fixed.
            <br />
            The team starts by understanding the intent.
          </div>
        )}
        {(manager?.status === "working" || manager?.status === "queued") && (
          <p class="chat-working" role="status">
            <span class="tiny-led" />
            {manager.status === "working"
              ? "The Manager is working on it…"
              : "The Manager's turn is waiting in line."}
          </p>
        )}
      </div>
      <form class="chat-compose" onSubmit={submit}>
        <textarea
          aria-label="Message to the Manager"
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
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

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function RegisterProject({
  send,
  busy,
  onClose,
}: {
  send: Send;
  busy: boolean;
  onClose: () => void;
}) {
  const [id, setId] = useState("");
  const [repo, setRepo] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [verify, setVerify] = useState("");
  const [setup, setSetup] = useState("");
  const [protectedPaths, setProtectedPaths] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [registered, setRegistered] = useState<string | null>(null);
  const verifyCommands = lines(verify);
  const ready =
    id.trim() && repo.trim() && baseBranch.trim() && verifyCommands.length > 0;
  async function submit(event: Event) {
    event.preventDefault();
    if (!ready || busy) return;
    const paths = lines(protectedPaths);
    const sent = await send({
      name: "register-project",
      payload: {
        id: id.trim(),
        repo: repo.trim(),
        baseBranch: baseBranch.trim(),
        verifyCommands,
        ...(setup.trim() && { setupCommand: setup.trim() }),
        ...(paths.length > 0 && { protectedPaths: paths }),
        ...(name.trim() && { name: name.trim() }),
        ...(description.trim() && { description: description.trim() }),
      },
    });
    if (sent) setRegistered(id.trim());
  }
  if (registered)
    return (
      <div class="register-project-done" role="status">
        <p>
          <Icon name="check" />
          <strong>{registered}</strong> was written to the projects folder.
        </p>
        <p class="form-note">
          It starts with the next restart of the office: stop it and start it
          again the way you started it, <code>npm run start</code> in a terminal
          or a restart of its service on a server. Until then it does not appear
          in the project list.
        </p>
        <div class="modal-actions">
          <button class="primary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  return (
    <form class="register-project" onSubmit={submit}>
      <p class="form-note">
        For a repository that already exists. This does not create one: it gives
        the shop a project that works on it.
      </p>
      <div class="register-project-row">
        <div>
          <label class="form-label" for="registerId">
            ID
          </label>
          <input
            id="registerId"
            type="text"
            required
            minLength={2}
            maxLength={40}
            pattern="[a-z][a-z0-9\-]+"
            title="Lowercase letters, digits and hyphens. Starts with a letter, 2 to 40 characters."
            placeholder="my-project"
            autocomplete="off"
            spellcheck={false}
            value={id}
            onInput={(event) => setId(event.currentTarget.value)}
          />
        </div>
        <div>
          <label class="form-label" for="registerRepo">
            REPOSITORY
          </label>
          <input
            id="registerRepo"
            type="text"
            required
            pattern="[\w.\-]+/[\w.\-]+"
            title="owner/name"
            placeholder="owner/name"
            autocomplete="off"
            spellcheck={false}
            value={repo}
            onInput={(event) => setRepo(event.currentTarget.value)}
          />
        </div>
        <div>
          <label class="form-label" for="registerBranch">
            BASE BRANCH
          </label>
          <input
            id="registerBranch"
            type="text"
            required
            autocomplete="off"
            spellcheck={false}
            value={baseBranch}
            onInput={(event) => setBaseBranch(event.currentTarget.value)}
          />
        </div>
      </div>
      <label class="form-label" for="registerVerify">
        VERIFY COMMANDS · ONE PER LINE
      </label>
      <textarea
        id="registerVerify"
        class="mono"
        required
        rows={3}
        spellcheck={false}
        placeholder={"npm test\nnpm run typecheck"}
        value={verify}
        onInput={(event) => setVerify(event.currentTarget.value)}
      />
      <label class="form-label" for="registerSetup">
        SETUP COMMAND · OPTIONAL
      </label>
      <input
        id="registerSetup"
        type="text"
        autocomplete="off"
        spellcheck={false}
        placeholder="npm ci"
        value={setup}
        onInput={(event) => setSetup(event.currentTarget.value)}
      />
      <label class="form-label" for="registerProtected">
        PROTECTED PATHS · OPTIONAL, ONE PER LINE
      </label>
      <textarea
        id="registerProtected"
        class="mono"
        rows={2}
        spellcheck={false}
        value={protectedPaths}
        onInput={(event) => setProtectedPaths(event.currentTarget.value)}
      />
      <label class="form-label" for="registerName">
        NAME · OPTIONAL
      </label>
      <input
        id="registerName"
        type="text"
        maxLength={60}
        value={name}
        onInput={(event) => setName(event.currentTarget.value)}
      />
      <label class="form-label" for="registerDescription">
        DESCRIPTION · OPTIONAL
      </label>
      <textarea
        id="registerDescription"
        rows={2}
        maxLength={280}
        value={description}
        onInput={(event) => setDescription(event.currentTarget.value)}
      />
      <div class="modal-actions">
        <button class="secondary-button" type="button" onClick={onClose}>
          Cancel
        </button>
        <button class="primary-button" type="submit" disabled={busy || !ready}>
          Register the project
          <Icon name="arrow" />
        </button>
      </div>
    </form>
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
  onOrder,
}: {
  message: Message;
  project: Project;
  send: Send;
  busy: boolean;
  onOrder: (order: Order) => void;
}) {
  const order = message.orderId
    ? project.orders.find((candidate) => candidate.id === message.orderId)
    : undefined;
  const decision = message.decisionId
    ? project.decisions.find((candidate) => candidate.id === message.decisionId)
    : undefined;
  return (
    <article
      class={`chat-message ${message.author}`}
      id={decision ? `chat-${decision.id}` : undefined}
    >
      <span>{authors[message.author]}</span>
      <RichText text={order ? message.text.split("\n\n")[0]! : message.text} />
      {message.consulted.length > 0 && (
        <small class="chat-consulted">
          Consulted {message.consulted.join(", ")}
        </small>
      )}
      {order && (
        <ChatPlan
          orders={planOf(project.orders, order)}
          send={send}
          busy={busy}
          onOrder={onOrder}
        />
      )}
      {decision && <ChatQuestion decision={decision} send={send} busy={busy} />}
    </article>
  );
}

function ChatPlan({
  orders,
  send,
  busy,
  onOrder,
}: {
  orders: Order[];
  send: Send;
  busy: boolean;
  onOrder: (order: Order) => void;
}) {
  const first = orders[0]!;
  const toSign = orders.filter(
    (order) => order.status === "awaiting_signature",
  );
  return (
    <div class="chat-order">
      {orders.length > 1 && (
        <header>
          <span class="mono muted">
            PLAN · {orders.length} ORDERS, IN THIS SEQUENCE
          </span>
        </header>
      )}
      <ol class={orders.length > 1 ? "" : "chat-order-single"}>
        {orders.map((order) => (
          <li key={order.id}>
            <strong>
              <RichLine text={order.title} />
            </strong>
            <p>
              <RichLine text={order.summary} />
            </p>
            <footer>
              <span class="mono muted">{order.id}</span>
              <span class={`status-chip ${order.status}`}>
                {orderStatus[order.status]}
              </span>
              <span class="chat-order-risk">{order.risk} risk</span>
              <button
                class="text-button"
                type="button"
                onClick={() => onOrder(order)}
              >
                Open the brief
                <Icon name="arrow" />
              </button>
            </footer>
          </li>
        ))}
      </ol>
      {toSign.length > 0 && (
        <button
          class="primary-button"
          type="button"
          disabled={busy}
          onClick={() =>
            void send({ name: "sign-plan", payload: { plan: first.plan } })
          }
        >
          {orders.length > 1 ? "Sign the plan" : "Sign"}
          <Icon name="check" />
        </button>
      )}
    </div>
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
