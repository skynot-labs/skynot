import type { Projection, StoredEvent } from "../../kernel/events";
import { asManagerEvent, type DecisionId, type MessageId } from "../domain";

export interface ChatMessage {
  readonly id: MessageId;
  readonly author: "director" | "manager";
  readonly text: string;
  readonly at: string;
  readonly orderId: string | null;
  readonly decisionId: DecisionId | null;
}

export interface Decision {
  readonly id: DecisionId;
  readonly question: string;
  readonly options: readonly string[];
  readonly askedAt: string;
  readonly answer: string | null;
}

export class ChatProjection implements Projection {
  private readonly chat: ChatMessage[] = [];
  private readonly decisionsById = new Map<DecisionId, Decision>();

  apply(stored: StoredEvent): void {
    const event = asManagerEvent(stored);
    if (!event) return;

    switch (event.type) {
      case "manager.message_received":
        this.chat.push({ id: event.payload.messageId, author: "director", text: event.payload.text, at: stored.occurredAt, orderId: null, decisionId: null });
        break;
      case "manager.replied":
        this.chat.push({ id: event.payload.messageId, author: "manager", text: event.payload.text, at: stored.occurredAt, orderId: event.payload.orderId, decisionId: event.payload.decisionId });
        break;
      case "manager.decision_asked":
        this.decisionsById.set(event.payload.decisionId, { ...event.payload, id: event.payload.decisionId, askedAt: stored.occurredAt, answer: null });
        break;
      case "manager.decision_answered": {
        const decision = this.decisionsById.get(event.payload.decisionId);
        if (decision) this.decisionsById.set(decision.id, { ...decision, answer: event.payload.answer });
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
}
