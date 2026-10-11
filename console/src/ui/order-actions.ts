import type { Order } from "../contracts";

// What the service would accept for this order right now, so the detail offers nothing it then refuses.
export function orderActions(order: Order, simulated: boolean) {
  const stuckOnBench = order.status === "on_bench" && !order.working && (order.blocked !== null || order.question !== null);
  return {
    discard: order.status === "awaiting_signature" || order.status === "signed" || stuckOnBench,
    sign: order.status === "awaiting_signature",
    stop: order.working,
    reassign: !order.working && ["signed", "on_bench", "in_review"].includes(order.status),
    merge: simulated && order.status === "in_review" && !order.working,
  };
}
