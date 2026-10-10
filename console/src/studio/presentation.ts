import type { Project, Agent } from "../contracts";
import { agentAppearance, type Appearance } from "../application/appearance";
import { defaultStudioPreferences, type StudioPreferences } from "./model";
import { ambientAvatar } from "./wardrobe";
import type { SceneState } from "../ui/office-renderer";
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
export function waitingOnDirector(project: Project) {
  return (
    project.inbox.length +
    project.teamChanges.length +
    project.briefingChanges.length +
    project.orders.filter((order) => order.status === "awaiting_signature")
      .length
  );
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
    pending: waitingOnDirector(project),
    settings,
    agents: project.agents.map((agent) => ({
      id: agent.id,
      role: agent.role,
      kind: agent.kind,
      status: agent.status,
      ...studioAgentAppearance(project.id, agent, appearance, settings),
    })),
  };
}
