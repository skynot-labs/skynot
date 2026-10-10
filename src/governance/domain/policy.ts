import { z } from "zod";

const RepoPolicySchema = z.object({
  name: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  base_branch: z.string().min(1),
  setup_command: z.string().min(1).nullable(),
  verify_commands: z.array(z.string().min(1)).min(1),
  protected_paths: z.array(z.string().min(1)),
});

export const PolicySchema = z
  .object({
    version: z.literal(1),
    repos: z.array(RepoPolicySchema).min(1),
    branch_prefix: z.string().min(1),
    labels: z.object({
      prefix: z.string().min(1),
      trigger: z.string().min(1),
    }),
    limits: z.object({
      actions_per_order_per_day: z.number().int().positive(),
      actions_per_day: z.number().int().positive(),
      max_parallel: z.number().int().positive(),
      max_rounds: z.number().int().min(1).max(5),
    }),
    run_budget: z.object({
      timeout_seconds: z.number().positive(),
      max_usd: z.number().positive(),
      max_usd_per_day: z.number().positive().optional(),
    }),
    memory: z.object({
      max_memory_chars: z.number().int().min(500),
    }),
  })
  .superRefine((policy, context) => {
    if (!policy.labels.trigger.startsWith(policy.labels.prefix)) {
      context.addIssue({ code: "custom", path: ["labels", "trigger"], message: `must start with "${policy.labels.prefix}"` });
    }
    const names = policy.repos.map((repo) => repo.name);
    const duplicate = names.find((name, index) => names.indexOf(name) !== index);
    if (duplicate) {
      context.addIssue({ code: "custom", path: ["repos"], message: `${duplicate} is listed twice` });
    }
  });

export type Policy = z.infer<typeof PolicySchema>;
export type RepoPolicy = Policy["repos"][number];
