import type { AgentStatus, Order } from "../contracts";

export const usd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
export const agentStatus: Record<AgentStatus, string> = {
  working: "Working",
  queued: "In line",
  idle: "Available",
  "waiting-director": "Waiting on you",
};
export const orderStatus: Record<Order["status"], string> = {
  awaiting_signature: "To sign",
  signed: "Signed",
  on_bench: "On the bench",
  in_review: "In review",
  delivered: "Delivered",
  discarded: "Discarded",
};
