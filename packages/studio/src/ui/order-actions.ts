import type { Command, Order } from "../contracts";

// What the service would accept for this order right now, so the detail offers nothing it then refuses.
export function orderActions(order: Order, mergesHere: boolean) {
  const started = order.status === "on_bench" || order.status === "in_review";
  const stuck = started && !order.working && (order.blocked !== null || order.question !== null);
  return {
    discard: order.status === "awaiting_signature" || order.status === "signed" || stuck,
    sign: order.status === "awaiting_signature",
    stop: order.working,
    reassign: !order.working && ["signed", "on_bench", "in_review"].includes(order.status),
    merge: mergesHere && order.status === "in_review" && !order.working,
  };
}

// The one command that gets a blocked order moving, wherever the block is shown. A retry on protected paths would only block again.
export function unblocking(order: Order): { command: Command; label: string } | null {
  if (order.blocked === null || order.working) return null;
  const payload = { orderId: order.id };
  if (order.protectedPaths.length > 0) return { command: { name: "approve-protected-paths", payload }, label: `Approve ${order.protectedPaths.join(", ")}` };
  return order.status === "signed" || order.status === "on_bench" ? { command: { name: "retry-order", payload }, label: "Retry" } : null;
}
