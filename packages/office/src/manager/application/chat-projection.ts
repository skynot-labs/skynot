import { inScope, type Projection, type ProjectScope, type StoredEvent } from "../../kernel/events";
import { asManagerEvent, type DecisionId, type MessageId } from "../domain";

export interface ChatMessage {
  readonly id: MessageId;
  readonly author: "director" | "manager" | "ticket";
  readonly text: string;
  readonly at: string;
  readonly orderId: string | null;
  readonly decisionId: DecisionId | null;
  // The advisors asked before this reply was written.
  readonly consulted: readonly string[];
}

export interface Decision {
  readonly id: DecisionId;
  readonly question: string;
  readonly options: readonly string[];
  readonly askedAt: string;
  readonly ticket: number | null;
  readonly answer: string | null;
  readonly answeredAt: string | null;
}

export class ChatProjection implements Projection {
  private readonly chat: ChatMessage[] = [];
  private readonly decisionsById = new Map<DecisionId, Decision>();
  private asked: string[] = [];

  constructor(private readonly scope?: ProjectScope) {}

  apply(stored: StoredEvent): void {
    const event = asManagerEvent(stored);
    if (!event || !inScope(stored, this.scope)) return;

    switch (event.type) {
      case "manager.message_received":
        this.chat.push({ id: event.payload.messageId, author: "director", text: event.payload.text, at: stored.occurredAt, orderId: null, decisionId: null, consulted: [] });
        break;
      case "manager.ticket_received":
        this.chat.push({ id: event.payload.messageId, author: "ticket", text: `#${event.payload.ticket} ${event.payload.title}`, at: stored.occurredAt, orderId: null, decisionId: null, consulted: [] });
        break;
      case "manager.consulted":
        this.asked.push(event.payload.role);
        break;
      case "manager.replied":
        this.chat.push({ id: event.payload.messageId, author: "manager", text: event.payload.text, at: stored.occurredAt, orderId: event.payload.orderId, decisionId: event.payload.decisionId, consulted: this.asked });
        this.asked = [];
        break;
      case "manager.reported":
        this.asked = [];
        break;
      case "manager.decision_asked":
        this.decisionsById.set(event.payload.decisionId, {
          id: event.payload.decisionId,
          question: event.payload.question,
          options: event.payload.options,
          askedAt: stored.occurredAt,
          ticket: event.payload.ticket ?? null,
          answer: null,
          answeredAt: null,
        });
        break;
      case "manager.decision_answered": {
        const decision = this.decisionsById.get(event.payload.decisionId);
        if (decision) this.decisionsById.set(decision.id, { ...decision, answer: event.payload.answer, answeredAt: stored.occurredAt });
        break;
      }
    }
  }

  messages(): readonly ChatMessage[] {
    return this.chat;
  }

  recent(count: number): readonly ChatMessage[] {
    return this.chat.slice(-count);
  }

  decision(id: string): Decision | undefined {
    return this.decisionsById.get(id as DecisionId);
  }

  openDecisions(): Decision[] {
    return [...this.decisionsById.values()].filter((decision) => decision.answer === null);
  }

  answeredDecisions(): Decision[] {
    return [...this.decisionsById.values()].filter((decision) => decision.answer !== null);
  }
}
