import type { InboxView, ShopState } from "./api";
import { AnswerBox } from "./AnswerBox";

type Send = (path: string, body: object) => Promise<boolean>;

const WHO: Record<InboxView["kind"], string> = {
  manager_question: "The Manager asks",
  ticket_doubt: "The Manager has a doubt about a ticket",
  worker_question: "A worker asks",
};

export function Inbox({ state, send }: { state: ShopState; send: Send }) {
  if (state.inbox.length === 0) return null;

  return (
    <section class="panel inbox" aria-label="Waiting for you">
      <h2>Waiting for you <span class="count">{state.inbox.length}</span></h2>
      <ul>
        {state.inbox.map((item) => (
          <li key={item.id}>
            <p class="from">
              {WHO[item.kind]}
              {item.ticket !== null && ` (ticket #${item.ticket})`}
              {item.orderId && ` on ${item.orderId}`}
            </p>
            <p class="ask">{item.question}</p>
            <AnswerBox
              placeholder="your answer"
              options={item.options}
              onAnswer={(answer) =>
                item.kind === "worker_question"
                  ? send("/api/commands/answer-question", { orderId: item.orderId, answer })
                  : send("/api/commands/answer-decision", { decisionId: item.id, answer })
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
