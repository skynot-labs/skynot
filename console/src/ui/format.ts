import type { AgentStatus, Order, Run } from "../contracts";

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
export const dayTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
// How long ago, so an old entry is told from a fresh one at a glance; the exact moment goes in the title.
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (60 * 24))} d ago`;
}
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
export const tokenCount = (value: number) =>
  compact.format(value).replace("K", "k");
export const agentStatus: Record<AgentStatus, string> = {
  working: "Working",
  queued: "In line",
  idle: "Available",
  "waiting-director": "Waiting on you",
  error: "Last run failed",
};
export const runOutcome: Record<NonNullable<Run["outcome"]>, string> = {
  completed: "Completed",
  failed: "Failed",
  cancelled: "Stopped",
  interrupted: "Interrupted",
};
export const orderStatus: Record<Order["status"], string> = {
  awaiting_signature: "To sign",
  signed: "Signed",
  on_bench: "On the bench",
  in_review: "In review",
  delivered: "Delivered",
  discarded: "Discarded",
};
