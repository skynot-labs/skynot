import { z } from "zod";

export const ENGINES = ["claude", "codex"] as const;

const RoleSchema = z.strictObject({
  engine: z.enum(ENGINES),
  model: z.string().min(1).optional(),
});

const RESERVED_NAMES = ["manager", "developer", "code_reviewer"];

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
      code_reviewer: RoleSchema.optional(),
    }),
    workers: z.record(z.string().regex(/^[a-z][a-z0-9-]{1,23}$/), RoleSchema).default({}),
    advisors: z.record(z.string().regex(/^[a-z][a-z0-9-]{1,23}$/), AdvisorFileSchema).default({}),
    library: z.record(z.string().regex(/^[a-z][a-z0-9-]{1,23}$/), AdvisorFileSchema).default({}),
  })
  .superRefine((team, context) => {
    const { developer, code_reviewer: reviewer } = team.roles;
    if (reviewer && reviewer.engine === developer.engine && reviewer.model === developer.model) {
      context.addIssue({ code: "custom", path: ["roles", "code_reviewer"], message: "the code reviewer must use a different engine or model than the developer, who wrote the code" });
    }
    for (const [name, worker] of Object.entries(team.workers)) {
      if (RESERVED_NAMES.includes(name)) context.addIssue({ code: "custom", path: ["workers", name], message: `"${name}" is already a role` });
      if (name in team.advisors || name in team.library) context.addIssue({ code: "custom", path: ["workers", name], message: `"${name}" is already listed as an advisor` });
      if (reviewer && reviewer.engine === worker.engine && reviewer.model === worker.model) {
        context.addIssue({ code: "custom", path: ["workers", name], message: "the code reviewer must use a different engine or model than every worker" });
      }
    }
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
export type RoleSetup = z.infer<typeof RoleSchema>;

// In a Team the soul is the text of the file the team file points to.
export type Advisor = Omit<TeamFile["advisors"][string], "soul"> & { soul: string };
export type Team = Omit<TeamFile, "advisors" | "library" | "workers"> & {
  workers?: TeamFile["workers"]; advisors: Record<string, Advisor>; library: Record<string, Advisor> };

export function describeRoles(team: Pick<TeamFile, "roles"> & { workers?: Record<string, RoleSetup>; advisors: Record<string, RoleSetup> }): Array<{ role: string; engine: RoleSetup["engine"]; model: string | null }> {
  const setups = [...Object.entries(team.roles), ...Object.entries(team.workers ?? {}), ...Object.entries(team.advisors)] as Array<[string, RoleSetup]>;
  return setups.map(([role, setup]) => ({ role, engine: setup.engine, model: setup.model ?? null }));
}
