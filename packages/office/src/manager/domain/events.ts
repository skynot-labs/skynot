import type { Id } from "../../kernel";
import type { DomainEvent } from "../../kernel/events";

export type MessageId = Id<"msg">;
export type DecisionId = Id<"dec">;

export type ManagerEvent =
  | { type: "manager.message_received"; payload: { messageId: MessageId; text: string } }
  | { type: "manager.ticket_received"; payload: { messageId: MessageId; ticket: number; title: string; text: string } }
  | {
      type: "manager.replied";
      payload: { messageId: MessageId; text: string; orderId: string | null; decisionId: DecisionId | null };
    }
  | { type: "manager.decision_asked"; payload: { decisionId: DecisionId; question: string; options: string[]; ticket?: number } }
  | { type: "manager.decision_answered"; payload: { decisionId: DecisionId; answer: string } }
  | { type: "manager.answer_rejected"; payload: { attempt: number; issues: string } }
  | { type: "manager.consulted"; payload: { role: string; question: string } }
  | { type: "manager.advised"; payload: { role: string; answer: string } }
  | { type: "manager.advisor_failed"; payload: { role: string; reason: string } };

export function asManagerEvent(event: DomainEvent): ManagerEvent | null {
  return event.type.startsWith("manager.") ? (event as ManagerEvent) : null;
}
