import { MAX_SPEC, SPEC_FILE } from "@skynot/contract";
import type { ComponentChildren } from "preact";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import type { Decision, Message, Order, Project, Send } from "../contracts";
import { planOf } from "../application/plans";
import { OrderChip, WorkerQuestion } from "./OrderDetail";
import { Icon } from "./Icon";
import { RichLine, RichText } from "./RichText";
import "./shell.css";
export { AvatarEditor } from "./AvatarEditor";

export function Modal({
  title,
  eyebrow,
  children,
  notice,
  onClose,
  size = "normal",
  covered = false,
}: {
  title: string;
  eyebrow: string;
  children: ComponentChildren;
  notice?: ComponentChildren;
  onClose: () => void;
  size?: "normal" | "wide" | "full";
  covered?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);
  const typedIn = useRef(new Set<HTMLInputElement | HTMLTextAreaElement>());
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const closeUnlessTyped = () => {
    const holdsText = [...typedIn.current].some(
      (field) => field.isConnected && field.value !== "",
    );
    if (!holdsText) latestClose.current();
  };
  // A full panel opens beside the sidebar, which has to stay usable: showModal would make it inert.
  const beside = size === "full";
  // Closed while the dialog is still in the document, the only place the platform returns focus from.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    opener.current = document.activeElement;
    if (beside) {
      element.show();
      element.focus();
    } else element.showModal();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || element.hidden) return;
      // Prevented here and not on cancel: Chromium closes a modal on a second Escape whatever cancel answered.
      event.preventDefault();
      if (!clearedSearch(event.target)) closeUnlessTyped();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      element.close();
      // What this dialog covered is still hidden or inert here and is given back later in this same commit.
      queueMicrotask(() => returnFocus(opener.current));
    };
  }, []);
  return (
    <>
      {beside && (
        <div
          class="panel-backdrop"
          hidden={covered}
          onClick={closeUnlessTyped}
        />
      )}
      <dialog
        ref={ref}
        tabIndex={-1}
        hidden={covered}
        class={size === "normal" ? "" : `modal-${size}`}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          closeUnlessTyped();
        }}
        onInput={(event) => {
          const field = event.target;
          if (
            field instanceof HTMLTextAreaElement ||
            (field instanceof HTMLInputElement && field.type === "text")
          )
            typedIn.current.add(field);
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
            closeUnlessTyped();
        }}
      >
        <div class="modal-header">
          <div>
            <div class="eyebrow">{eyebrow}</div>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            class="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <Icon name="close" />
          </button>
        </div>
        {notice}
        {children}
      </dialog>
    </>
  );
}

// Not every browser empties a search field on Escape, so it is emptied here and the field's own listeners are told.
function clearedSearch(target: EventTarget | null): boolean {
  if (
    !(target instanceof HTMLInputElement) ||
    target.type !== "search" ||
    target.value === ""
  )
    return false;
  target.value = "";
  target.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

// The platform returns focus to the opener only when it can take it as the dialog closes; focus the director moved elsewhere is left alone.
function returnFocus(opener: Element | null) {
  const places = [
    opener,
    document.querySelector("dialog[open]:not([hidden])"),
    document.querySelector("main"),
  ];
  for (const place of places) {
    if (document.activeElement !== document.body) return;
    if (place instanceof HTMLElement) place.focus();
  }
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
  const box = useRef<HTMLTextAreaElement>(null);
  const backToBox = () => box.current?.focus();
  const manager = project.agents.find((agent) => agent.kind === "manager");
  const latest = project.chat.at(-1)?.decisionId;
  const buried = project.decisions.filter((decision) => decision.id !== latest);
  // A worker's question is answered under the last message about its order, so the box shows once.
  const lastAbout = new Map(
    project.chat.flatMap((entry) =>
      entry.orderId ? [[entry.orderId, entry.id] as const] : [],
    ),
  );
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [project.chat, manager?.status]);
  async function submit(event: Event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    backToBox();
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
            onSettled={backToBox}
            answerable={
              entry.orderId !== null && lastAbout.get(entry.orderId) === entry.id
            }
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
          ref={box}
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
          placeholder="An idea, a bug, a question… Ctrl+Enter sends it."
        />
        <button
          class="primary-button"
          disabled={!message.trim()}
          aria-disabled={busy}
          title="Ctrl+Enter sends it"
          aria-keyshortcuts="Control+Enter Meta+Enter"
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
  const [local, setLocal] = useState(false);
  const [repo, setRepo] = useState("");
  const [spec, setSpec] = useState<{ name: string; text: string } | null>(null);
  const [specProblem, setSpecProblem] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState("main");
  const [verify, setVerify] = useState("");
  const [setup, setSetup] = useState("");
  const [protectedPaths, setProtectedPaths] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [registered, setRegistered] = useState<string | null>(null);
  const verifyCommands = lines(verify);
  const ready =
    id.trim() &&
    (local || repo.trim()) &&
    baseBranch.trim() &&
    verifyCommands.length > 0 &&
    specProblem === null;
  function choose(here: boolean) {
    setLocal(here);
    // An empty project has nothing to check yet; the Manager proposes real commands once it has.
    if (here && !verify.trim()) setVerify("true");
  }
  async function pickSpec(file: File | undefined) {
    setSpec(null);
    setSpecProblem(null);
    if (!file) return;
    if (!SPEC_FILE.test(file.name))
      return setSpecProblem("A spec is a .md, .markdown or .txt file.");
    const text = await file.text();
    if (text.length > MAX_SPEC)
      return setSpecProblem(
        `A spec has at most ${MAX_SPEC.toLocaleString("en")} characters.`,
      );
    if (!text.trim() || text.includes("\u0000"))
      return setSpecProblem("That file is empty or not text.");
    setSpec({ name: file.name, text });
  }
  async function submit(event: Event) {
    event.preventDefault();
    if (!ready || busy) return;
    const paths = lines(protectedPaths);
    const sent = await send({
      name: "register-project",
      payload: {
        id: id.trim(),
        ...(local ? { local: true as const, ...(spec && { spec }) } : { repo: repo.trim() }),
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
      <fieldset class="register-project-where">
        <legend class="form-label">WHERE IT LIVES</legend>
        <label>
          <input
            type="radio"
            name="registerWhere"
            checked={!local}
            onChange={() => choose(false)}
          />
          On GitHub
        </label>
        <label>
          <input
            type="radio"
            name="registerWhere"
            checked={local}
            onChange={() => choose(true)}
          />
          On this machine, from nothing
        </label>
      </fieldset>
      <p class="form-note">
        {local
          ? "The office keeps the repository itself and you merge from the studio. Publish it later by pushing a clone to GitHub."
          : "For a repository that already exists. This does not create one: it gives the shop a project that works on it."}
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
        {!local && (
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
        )}
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
      {local && (
        <>
          <label class="form-label" for="registerSpec">
            SPEC · OPTIONAL, THE FIRST COMMIT
          </label>
          <input
            id="registerSpec"
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            aria-describedby={specProblem ? "registerSpecProblem" : undefined}
            onChange={(event) => void pickSpec(event.currentTarget.files?.[0])}
          />
          {specProblem && (
            <p id="registerSpecProblem" class="form-error" role="alert">
              {specProblem}
            </p>
          )}
        </>
      )}
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
        <button
          class="primary-button"
          type="submit"
          disabled={!ready}
          aria-disabled={busy}
        >
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
  onSettled,
  answerable,
}: {
  message: Message;
  project: Project;
  send: Send;
  busy: boolean;
  onOrder: (order: Order) => void;
  onSettled: () => void;
  answerable: boolean;
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
          onSigned={onSettled}
        />
      )}
      {order && answerable && (
        <WorkerQuestion
          order={order}
          send={send}
          busy={busy}
          onSent={onSettled}
        />
      )}
      {decision && (
        <ChatQuestion
          decision={decision}
          send={send}
          busy={busy}
          onAnswered={onSettled}
        />
      )}
    </article>
  );
}

function ChatPlan({
  orders,
  send,
  busy,
  onOrder,
  onSigned,
}: {
  orders: Order[];
  send: Send;
  busy: boolean;
  onOrder: (order: Order) => void;
  onSigned: () => void;
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
              <OrderChip order={order} />
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
          aria-disabled={busy}
          onClick={() =>
            void send({
              name: "sign-plan",
              payload: { plan: first.plan },
            }).then((ok) => {
              if (ok) onSigned();
            })
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
  onAnswered,
}: {
  decision: Decision;
  send: Send;
  busy: boolean;
  onAnswered: () => void;
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
              aria-disabled={busy}
              aria-pressed={other === option}
              onClick={() => {
                if (!busy) setOther(option);
              }}
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
          if (!value || !(await answer(value))) return;
          setOther("");
          onAnswered();
        }}
      >
        <input
          type="text"
          aria-label={`Your answer to: ${decision.question}`}
          maxLength={4000}
          value={other}
          placeholder={
            decision.options.length > 0
              ? "Pick an option or answer in your own words"
              : "Answer in your own words"
          }
          onInput={(event) => setOther(event.currentTarget.value)}
        />
        <button
          class="secondary-button"
          type="submit"
          disabled={!other.trim()}
          aria-disabled={busy}
        >
          Answer
        </button>
      </form>
    </div>
  );
}
