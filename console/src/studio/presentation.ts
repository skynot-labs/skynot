import type { Project, Agent } from "../contracts";
import { agentAppearance, type Appearance } from "../application/appearance";
import { defaultStudioPreferences, type StudioPreferences } from "./model";
import { ambientAvatar } from "./wardrobe";
import { agentWork } from "../application/agent-work";
import type { SceneState } from "../ui/office-renderer";

export type BubbleTarget =
  | { kind: "agent" }
  | { kind: "order"; id: string }
  | { kind: "desk"; tab: "questions" | "signatures" };
export type Bubble = {
  tone: "ask" | "alert" | "done" | "busy" | "wait";
  text: string;
  open: BubbleTarget;
};

const CLOSED = ["delivered", "discarded"];

// What an agent holds up over its desk, most urgent first: what waits on the director, then what it finished, then what it is doing.
export function agentBubble(project: Project, agent: Agent): Bubble | null {
  if (agent.kind === "manager") {
    const questions = project.inbox.filter(
      (item) => item.kind !== "worker_question",
    ).length;
    if (questions > 0)
      return {
        tone: "ask",
        text: questions === 1 ? "? ASKS YOU" : `? ${questions} QUESTIONS`,
        open: { kind: "desk", tab: "questions" },
      };
    const toSign =
      project.orders.filter((order) => order.status === "awaiting_signature")
        .length +
      project.teamChanges.length +
      project.briefingChanges.length;
    if (toSign > 0)
      return {
        tone: "ask",
        text: `${toSign} TO SIGN`,
        open: { kind: "desk", tab: "signatures" },
      };
  }
  const work = agentWork(project, agent);
  if (work.reach.kind === "answer")
    return { tone: "ask", text: "? ASKS YOU", open: { kind: "agent" } };
  const blocked = work.open.find((order) => order.blocked !== null);
  if (blocked)
    return { tone: "alert", text: "! BLOCKED", open: { kind: "agent" } };
  if (agent.status === "working")
    return { tone: "busy", text: "···", open: { kind: "agent" } };
  if (agent.status === "queued")
    return { tone: "wait", text: "IN LINE", open: { kind: "agent" } };
  if (agent.status === "error")
    return { tone: "alert", text: "! RUN FAILED", open: { kind: "agent" } };
  const finished = work.open.find(
    (order) => order.status === "in_review" && !order.working,
  );
  if (finished)
    return {
      tone: "done",
      text: finished.ready ? "✓ READY TO MERGE" : "✓ PR OPEN",
      open: { kind: "order", id: finished.id },
    };
  return null;
}
// Where an agent's work takes it, when that work is done beside someone else.
export function agentErrand(project: Project, agent: Agent): { beside: string; doing: string } | null {
  if (agent.status !== "working") return null;
  if (agent.orderId && /review/i.test(agent.role)) {
    const author = project.agents.find(
      (other) =>
        other.id !== agent.id &&
        other.kind === "worker" &&
        agentWork(project, other).open.some((order) => order.id === agent.orderId),
    );
    return author ? { beside: author.id, doing: `reviewing ${agent.orderId}` } : null;
  }
  if (agent.kind !== "advisor" || agent.orderId) return null;
  const manager = project.agents.find((other) => other.kind === "manager");
  return manager ? { beside: manager.id, doing: "advising" } : null;
}
export function studioAgentAppearance(
  projectId: string,
  agent: Agent,
  appearance: Appearance,
  settings: StudioPreferences = defaultStudioPreferences,
) {
  const base = agentAppearance(projectId, agent, appearance);
  return {
    ...base,
    avatar:
      appearance[`${projectId}/${agent.id}`]?.followStudioLook === false
        ? base.avatar
        : ambientAvatar(base.avatar, settings),
  };
}
export function studioScene(
  project: Project,
  appearance: Appearance,
  settings: StudioPreferences,
  shopPaused = false,
): SceneState {
  return {
    name: project.name,
    accent: project.accent,
    paused: shopPaused || Boolean(project.paused),
    pending: project.needsYou,
    openOrders: project.orders.filter(
      (order) => !CLOSED.includes(order.status),
    ).length,
    delivered: project.orders.filter((order) => order.status === "delivered").length,
    settings,
    agents: project.agents.map((agent) => ({
      id: agent.id,
      role: agent.role,
      kind: agent.kind,
      status: agent.status,
      bubble: agentBubble(project, agent),
      errand: agentErrand(project, agent),
      ...studioAgentAppearance(project.id, agent, appearance, settings),
    })),
  };
}
