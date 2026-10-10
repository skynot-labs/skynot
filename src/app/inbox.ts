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

export function inboxOf(shop: Shop, projectId: string): InboxItem[] {
  const desk = shop.desk(projectId);
  if (!desk) return [];

  const decisions = desk.chat.openDecisions().map(
    (decision): InboxItem => ({
      id: decision.id,
      kind: decision.ticket === null ? "manager_question" : "ticket_doubt",
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
