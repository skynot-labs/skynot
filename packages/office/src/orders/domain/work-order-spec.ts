import { z } from "zod";

export const CriterionSchema = z.object({
  statement: z.string().trim().min(5).max(140),
  verification: z.object({
    kind: z.enum(["command", "test", "behavior"]),
    detail: z.string().trim().min(3).max(200),
  }),
});

export const MAX_PLAN = 5;

// npm's rule for a package name, so a declared dependency can carry nothing else into the command that installs it.
export const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

export const DependencySchema = z.object({
  name: z.string().max(214).regex(PACKAGE_NAME, "an npm package name, without a version"),
  dev: z.boolean(),
});

// Two layers: `summary` is what the director reads, in plain words; everything else is the brief the team works from.
export const WorkOrderSpecSchema = z.object({
  title: z.string().trim().min(3).max(60),
  summary: z.string().trim().min(10).max(300),
  objective: z.string().trim().min(10).max(600),
  context: z.string().trim().min(10).max(600).optional(),
  approach: z.array(z.string().trim().min(3).max(200)).max(8).default([]),
  acceptanceCriteria: z.array(CriterionSchema).min(1).max(8),
  outOfScope: z.array(z.string().trim().min(3).max(200)).max(8),
  risk: z.enum(["low", "medium", "high"]),
  likelyFiles: z.array(z.string().trim().min(1).max(200)).max(12),
  // Installed by the office before the worker starts, once the director signed them with the order.
  dependencies: z.array(DependencySchema).max(10).optional(),
  dependsOn: z.array(z.string().regex(/^WO-\d{4}$/)).max(5).optional(),
  // Positions, from 1, of earlier orders of the same plan that must be merged first; they become `dependsOn` once the orders have ids.
  needs: z.array(z.number().int().min(1).max(MAX_PLAN - 1)).max(MAX_PLAN - 1).optional(),
});

export type Criterion = z.infer<typeof CriterionSchema>;
export type Dependency = z.infer<typeof DependencySchema>;
export type WorkOrderSpec = z.infer<typeof WorkOrderSpecSchema>;

export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}
