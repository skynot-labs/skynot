import type { Order } from "../contracts";

// The orders proposed together, in the sequence they are built. An order proposed alone is a plan of one.
export function planOf(orders: readonly Order[], order: Order): Order[] {
  return orders.filter((other) => other.plan === order.plan);
}

export function plansToSign(orders: readonly Order[]): Order[][] {
  const waiting = orders.filter((order) => order.status === "awaiting_signature");
  return [...new Set(waiting.map((order) => order.plan))].map((plan) => waiting.filter((order) => order.plan === plan));
}
