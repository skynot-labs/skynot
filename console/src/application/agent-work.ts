import type { Activity, Agent, Order, Project, Run } from "../contracts";

const OPEN: ReadonlyArray<Order["status"]> = ["signed", "on_bench", "in_review"];

// Where the director's words go: only what the service would accept for this agent right now.
export type Reach = { kind: "answer"; order: Order } | { kind: "redirect"; order: Order } | { kind: "manager" };

export interface AgentWork {
  current: Order | null;
  open: Order[];
  retry: Order | null;
  runs: Run[];
  trace: Activity[];
  reach: Reach;
}

export function agentWork(project: Project, agent: Agent): AgentWork {
  const held = agent.kind === "worker" ? project.orders.filter((order) => (order.worker ?? "developer") === agent.id) : [];
  const heldIds = new Set<string>(held.map((order) => order.id));
  const open = held.filter((order) => OPEN.includes(order.status));
  const idle = open.filter((order) => !order.working);
  return {
    current: open.find((order) => order.id === agent.orderId) ?? open.find((order) => order.working) ?? null,
    open,
    retry: idle.find((order) => order.blocked !== null && order.status !== "in_review") ?? null,
    runs: project.runs.filter((run) => run.role === agent.id),
    trace: project.activity.filter((entry) => entry.role === agent.id || entry.by === agent.id || (entry.role === null && entry.orderId !== null && heldIds.has(entry.orderId))),
    reach: reachOf(idle),
  };
}

function reachOf(idle: Order[]): Reach {
  const asked = idle.find((order) => order.question !== null);
  if (asked) return { kind: "answer", order: asked };
  const inReview = idle.find((order) => order.status === "in_review" && order.pullRequest !== null && order.issue !== null);
  return inReview ? { kind: "redirect", order: inReview } : { kind: "manager" };
}
