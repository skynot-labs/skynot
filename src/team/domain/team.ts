import { z } from "zod";

export const ENGINES = ["claude", "codex"] as const;

const RoleSchema = z.strictObject({
  engine: z.enum(ENGINES),
  model: z.string().min(1).optional(),
});

export const TeamSchema = z.strictObject({
  version: z.literal(1),
  roles: z.strictObject({
    manager: RoleSchema,
    developer: RoleSchema,
  }),
});

export type Team = z.infer<typeof TeamSchema>;
export type RoleName = keyof Team["roles"];
export type RoleSetup = Team["roles"][RoleName];

export function describeRoles(team: Team): Array<{ role: RoleName; engine: RoleSetup["engine"]; model: string | null }> {
  return (Object.keys(team.roles) as RoleName[]).map((role) => ({ role, engine: team.roles[role].engine, model: team.roles[role].model ?? null }));
}
