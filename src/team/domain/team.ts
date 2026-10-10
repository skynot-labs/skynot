import { z } from "zod";

export const ENGINES = ["claude", "codex"] as const;

const RoleSchema = z.strictObject({
  engine: z.enum(ENGINES),
  model: z.string().min(1).optional(),
});

const RESERVED_NAMES = ["manager", "developer"];

const AdvisorFileSchema = z.strictObject({
  engine: z.enum(ENGINES),
  model: z.string().min(1).optional(),
  description: z.string().trim().min(3).max(160),
  soul: z.string().min(1),
});

export const TeamFileSchema = z
  .strictObject({
    version: z.literal(1),
    roles: z.strictObject({
      manager: RoleSchema,
      developer: RoleSchema,
    }),
    advisors: z.record(z.string().regex(/^[a-z][a-z0-9-]{1,23}$/), AdvisorFileSchema).default({}),
    library: z.record(z.string().regex(/^[a-z][a-z0-9-]{1,23}$/), AdvisorFileSchema).default({}),
  })
  .superRefine((team, context) => {
    for (const section of ["advisors", "library"] as const) {
      for (const name of Object.keys(team[section])) {
        if (RESERVED_NAMES.includes(name)) context.addIssue({ code: "custom", path: [section, name], message: `"${name}" is already a role` });
      }
    }
    for (const name of Object.keys(team.library)) {
      if (name in team.advisors) context.addIssue({ code: "custom", path: ["library", name], message: `"${name}" is already listed under advisors` });
    }
  });

export type TeamFile = z.infer<typeof TeamFileSchema>;
export type RoleName = keyof TeamFile["roles"];
export type RoleSetup = TeamFile["roles"][RoleName];

// In a Team the soul is the text of the file the team file points to.
export type Advisor = Omit<TeamFile["advisors"][string], "soul"> & { soul: string };
export type Team = Omit<TeamFile, "advisors" | "library"> & { advisors: Record<string, Advisor>; library: Record<string, Advisor> };

export function describeRoles(team: Pick<TeamFile, "roles"> & { advisors: Record<string, RoleSetup> }): Array<{ role: string; engine: RoleSetup["engine"]; model: string | null }> {
  const setups: Array<[string, RoleSetup]> = [...Object.entries(team.roles), ...Object.entries(team.advisors)];
  return setups.map(([role, setup]) => ({ role, engine: setup.engine, model: setup.model ?? null }));
}
