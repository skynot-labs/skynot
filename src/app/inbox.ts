import type { Decision } from "../manager";
import type { Shop } from "./shop";

// Everything that waits for the director's answer, whoever asked, in one list.
export interface InboxItem {
  readonly id: string;
  readonly kind: "manager_question" | "ticket_doubt" | "worker_question";
  readonly from: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly orderId: string | null;
  readonly ticket: number | null;
  readonly askedAt: string;
}

export interface AnsweredItem {
  readonly id: string;
  readonly kind: InboxItem["kind"];
  readonly from: string;
  readonly question: string;
  readonly answer: string;
  readonly orderId: string | null;
  readonly ticket: number | null;
  readonly askedAt: string;
  readonly answeredAt: string;
}

const kindOf = (decision: Decision): InboxItem["kind"] => (decision.ticket === null ? "manager_question" : "ticket_doubt");

export function inboxOf(shop: Shop, projectId: string): InboxItem[] {
  const desk = shop.desk(projectId);
  if (!desk) return [];

  const decisions = desk.chat.openDecisions().map(
    (decision): InboxItem => ({
      id: decision.id,
      kind: kindOf(decision),
      from: "manager",
      question: decision.question,
      options: decision.options,
      orderId: null,
      ticket: decision.ticket,
      askedAt: decision.askedAt,
    }),
  );
  const questions = shop.orders.listFor(projectId).flatMap((order): InboxItem[] => {
    const { question, questionAt } = shop.activity.linksFor(order.id);
    return question === null ? [] : [{ id: `question:${order.id}`, kind: "worker_question", from: shop.activity.linksFor(order.id).worker ?? "developer", question, options: [], orderId: order.id, ticket: order.ticket, askedAt: questionAt ?? "" }];
  });
  return [...decisions, ...questions].sort((a, b) => a.askedAt.localeCompare(b.askedAt));
}

export function answeredOf(shop: Shop, projectId: string, limit = 50): AnsweredItem[] {
  const desk = shop.desk(projectId);
  if (!desk) return [];

  const decisions = desk.chat.answeredDecisions().map(
    (decision): AnsweredItem => ({
      id: decision.id,
      kind: kindOf(decision),
      from: "manager",
      question: decision.question,
      answer: decision.answer ?? "",
      orderId: null,
      ticket: decision.ticket,
      askedAt: decision.askedAt,
      answeredAt: decision.answeredAt ?? decision.askedAt,
    }),
  );
  const questions = shop.orders.listFor(projectId).flatMap((order) =>
    shop.activity.linksFor(order.id).answered.map(
      (answered, position): AnsweredItem => ({ id: `question:${order.id}:${position + 1}`, kind: "worker_question", orderId: order.id, ticket: order.ticket, ...answered }),
    ),
  );
  return [...decisions, ...questions].sort((a, b) => b.answeredAt.localeCompare(a.answeredAt)).slice(0, limit);
}
