import { z } from "zod";
import type { Agent } from "../contracts";
import { config } from "../config";
import { avatarSchema, resolveAvatar } from "../avatars/model";

const appearanceSchema = z.record(
  z.string(),
  z.object({
    avatar: avatarSchema,
    alias: z.string().max(24),
    followStudioLook: z.boolean().optional(),
  }),
);
export type Appearance = z.input<typeof appearanceSchema>;

export function readAppearance(): Appearance {
  try {
    return appearanceSchema.parse(
      JSON.parse(localStorage.getItem(config.appearanceStorageKey) || "{}"),
    );
  } catch {
    return {};
  }
}
export function writeAppearance(value: Appearance) {
  localStorage.setItem(
    config.appearanceStorageKey,
    JSON.stringify(appearanceSchema.parse(value)),
  );
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
