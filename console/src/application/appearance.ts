import { z } from "zod";
import type { Agent, Command } from "../contracts";
import { config } from "../config";
import { avatarSchema, resolveAvatar } from "../avatars/model";
import {
  forgetLocalStudioAppearance,
  readLocalStudioAppearance,
  studioPreference,
} from "./studio-appearance";

const agentAppearanceSchema = z.object({
  avatar: avatarSchema,
  alias: z.string().max(24),
  followStudioLook: z.boolean().optional(),
});
type SetPreference = Extract<Command, { name: "set-preference" }>;
const appearanceSchema = z.record(z.string(), agentAppearanceSchema);
export type Appearance = z.input<typeof appearanceSchema>;
export type AgentAppearance = Appearance[string];

// Mirrors PREFERENCE_KEY and MAX_PREFERENCE_BYTES in src/app/preferences.ts, which the browser cannot import.
const AVATAR_KEY = /^avatar\/[a-z][a-z0-9-]{1,39}\/[a-z][a-z0-9_-]{0,39}$/;
const MAX_PREFERENCE_BYTES = 2048;

export function appearanceFrom(preferences: Record<string, unknown>): Appearance {
  const appearance: Appearance = {};
  for (const [key, value] of Object.entries(preferences)) {
    if (!AVATAR_KEY.test(key)) continue;
    const parsed = agentAppearanceSchema.safeParse(value);
    if (parsed.success) appearance[key.slice("avatar/".length)] = parsed.data;
  }
  return appearance;
}

export function avatarPreference(
  projectId: string,
  agentId: string,
  value: AgentAppearance | null,
): SetPreference | null {
  const key = `avatar/${projectId}/${agentId}`;
  if (!AVATAR_KEY.test(key)) return null;
  return {
    name: "set-preference",
    payload: { key, value: value && agentAppearanceSchema.parse(value) },
  };
}

export function agentAppearance(
  projectId: string,
  agent: Agent,
  appearance: Appearance,
) {
  const saved = appearance[`${projectId}/${agent.id}`];
  return {
    avatar: resolveAvatar(saved?.avatar ?? agent.avatar),
    name: saved?.alias || agent.name,
  };
}

export function localPreferencesToUpload(
  preferences: Record<string, unknown>,
): Command[] {
  const avatars = Object.entries(readLocalAppearance()).map(([id, value]) => {
    const [projectId = "", ...agentId] = id.split("/");
    return avatarPreference(projectId, agentId.join("/"), value);
  });
  const studios = Object.entries(readLocalStudioAppearance()).map(
    ([projectId, value]) => studioPreference(projectId, value),
  );
  return [...avatars, ...studios].flatMap((command) =>
    command &&
    !(command.payload.key in preferences) &&
    fits(command.payload.value)
      ? [command]
      : [],
  );
}

export async function uploadLocalPreferences(
  preferences: Record<string, unknown>,
  send: (command: Command) => Promise<void>,
): Promise<number> {
  const commands = localPreferencesToUpload(preferences);
  for (const command of commands) await send(command);
  forgetLocalAppearance();
  forgetLocalStudioAppearance();
  return commands.length;
}

function fits(value: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_PREFERENCE_BYTES;
}

function readLocalAppearance(): Appearance {
  try {
    return appearanceSchema.parse(
      JSON.parse(localStorage.getItem(config.appearanceStorageKey) || "{}"),
    );
  } catch {
    return {};
  }
}

function forgetLocalAppearance() {
  try {
    localStorage.removeItem(config.appearanceStorageKey);
  } catch {
    return;
  }
}
