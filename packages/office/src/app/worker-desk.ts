import { err, ok, type Result } from "../kernel";
import type { WorkerDesk } from "../manager";
import type { OrderError, OrdersProjection, WorkOrder } from "../orders";
import type { OrderFlow } from "./order-flow";

export interface WorkerDeskDependencies {
  flow(): Pick<OrderFlow, "answerQuestion" | "followUp">;
  orders: OrdersProjection;
  questionOf(orderId: string): string | null;
  projectId: string;
}

// The Manager writes to a worker the way the director's commands do, so every refusal of those commands holds here too.
export function createWorkerDesk({ flow, orders, questionOf, projectId }: WorkerDeskDependencies): WorkerDesk {
  const mine = () => orders.listFor(projectId);
  return {
    waiting: () => mine().flatMap((order) => {
      const question = questionOf(order.id);
      return question === null ? [] : [{ orderId: order.id, question }];
    }),
    inReview: () => mine().filter((order) => order.status === "in_review").map((order) => order.id),
    async passOn({ orderId, text, from }) {
      const order = mine().find((candidate) => candidate.id === orderId);
      if (!order) return err(`no order ${orderId} in this project`);

      let sent: Result<WorkOrder, OrderError>;
      if (questionOf(orderId) !== null) sent = await flow().answerQuestion(orderId, text, from === "manager" ? "manager" : "director_via_manager");
      else if (order.status === "in_review") sent = await flow().followUp(orderId, from === "manager" ? `The Manager, not the director, asks: ${text}` : text);
      else return err(`${orderId} has no question waiting for an answer and is not in review`);
      return sent.ok ? ok(undefined) : err(sent.error.message);
    },
  };
}
