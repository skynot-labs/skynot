import type { Id } from "../../kernel";
import type { DomainEvent } from "../../kernel/events";

export type MessageId = Id<"msg">;
export type DecisionId = Id<"dec">;

export type ManagerEvent =
  | { type: "manager.message_received"; payload: { messageId: MessageId; text: string } }
  | {
      type: "manager.replied";
      payload: { messageId: MessageId; text: string; orderId: string | null; decisionId: DecisionId | null };
    }
  | { type: "manager.decision_asked"; payload: { decisionId: DecisionId; question: string; options: string[] } }
  | { type: "manager.decision_answered"; payload: { decisionId: DecisionId; answer: string } };

export function asManagerEvent(event: DomainEvent): ManagerEvent | null {
  return event.type.startsWith("manager.") ? (event as ManagerEvent) : null;
}
