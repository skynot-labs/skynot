import { useState } from "preact/hooks";
import type { ChatView, DecisionView, ShopState } from "./api";

type Send = (path: string, body: object) => Promise<boolean>;

export function Chat({ state, send }: { state: ShopState; send: Send }) {
  const [text, setText] = useState("");
  const thinking = [...state.presence.working, ...state.presence.waiting].some((entry) => entry.role === "manager");

  async function submit(event: Event) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    if (!(await send("/api/commands/send-message", { text: message }))) setText(message);
  }

  return (
    <section class="panel chat" aria-label="Chat with the Manager">
      <h2>The Manager</h2>
      <ol class="messages">
        {state.chat.length === 0 && <li class="empty">Tell the Manager what you want built or fixed.</li>}
        {state.chat.map((message) => (
          <Message key={message.id} message={message} state={state} send={send} />
        ))}
        {thinking && <li class="thinking">The Manager is working on it…</li>}
      </ol>
      <form onSubmit={submit} class="composer">
        <textarea
          value={text}
          rows={2}
          placeholder="An idea, a bug, a question…"
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event);
          }}
        />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}

function Message({ message, state, send }: { message: ChatView; state: ShopState; send: Send }) {
  const order = message.orderId ? state.orders.find((candidate) => candidate.id === message.orderId) : undefined;
  const intro = order ? message.text.split("\n\n")[0] : message.text;
  const decision = message.decisionId ? state.decisions.find((candidate) => candidate.id === message.decisionId) : undefined;

  return (
    <li class={`message ${message.author}`}>
      <span class="who">{message.author === "director" ? "You" : "Manager"}</span>
      <p>{intro}</p>
      {order && <pre class="card">{order.card}</pre>}
      {decision && <Question decision={decision} send={send} />}
    </li>
  );
}

function Question({ decision, send }: { decision: DecisionView; send: Send }) {
  const [other, setOther] = useState("");
  const answer = (value: string) => send("/api/commands/answer-decision", { decisionId: decision.id, answer: value });

  return (
    <div class="question">
      <p class="ask">{decision.question}</p>
      <div class="choices">
        {decision.options.map((option) => (
          <button type="button" key={option} onClick={() => answer(option)}>{option}</button>
        ))}
      </div>
      <form
        class="other"
        onSubmit={(event) => {
          event.preventDefault();
          if (other.trim()) void answer(other.trim());
        }}
      >
        <input value={other} placeholder="or answer in your own words" onInput={(event) => setOther(event.currentTarget.value)} />
        <button type="submit" disabled={!other.trim()}>Answer</button>
      </form>
    </div>
  );
}
