import { z } from "zod";

export const CriterionSchema = z.object({
  statement: z.string().trim().min(5).max(140),
  verification: z.object({
    kind: z.enum(["command", "test", "behavior"]),
    detail: z.string().trim().min(3).max(200),
  }),
});

export const WorkOrderSpecSchema = z.object({
  title: z.string().trim().min(3).max(60),
  objective: z.string().trim().min(10).max(600),
  acceptanceCriteria: z.array(CriterionSchema).min(1).max(8),
  outOfScope: z.array(z.string().trim().min(3).max(200)).max(8),
  risk: z.enum(["low", "medium", "high"]),
  likelyFiles: z.array(z.string().trim().min(1).max(200)).max(12),
  dependsOn: z.array(z.string().regex(/^WO-\d{4}$/)).max(5).optional(),
});

export type Criterion = z.infer<typeof CriterionSchema>;
export type WorkOrderSpec = z.infer<typeof WorkOrderSpecSchema>;

export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}
