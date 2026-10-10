import { REVIEW_SYSTEM, ReviewSchema, reviewPrompt, type CodeReviewer } from "../delivery";
import { toEngineSchema, type EngineName, type RunScheduler } from "../execution";
import { err, ok } from "../kernel";

export interface CodeReviewerOptions {
  engine: EngineName;
  cwd: () => Promise<string>;
  timeoutMs: number;
  model?: string;
  maxUsd?: number;
  projectId?: string;
}

export function createCodeReviewer(scheduler: RunScheduler, options: CodeReviewerOptions): CodeReviewer {
  return {
    async review({ item, diff, signal }) {
      let cwd: string;
      try {
        cwd = await options.cwd();
      } catch (error) {
        return err(`could not read the repository: ${(error as Error).message}`);
      }

      const outcome = await scheduler.submit({
        role: "code_reviewer",
        engine: options.engine,
        orderId: item.id,
        ...(options.projectId && { projectId: options.projectId }),
        request: {
          prompt: reviewPrompt(item, diff),
          system: REVIEW_SYSTEM,
          cwd,
          access: "read",
          schema: toEngineSchema(ReviewSchema),
          timeoutMs: options.timeoutMs,
          ...(signal && { signal }),
          ...(options.model && { model: options.model }),
          ...(options.maxUsd && { maxUsd: options.maxUsd }),
        },
      });
      if (!outcome.ok) return err(outcome.error.message);

      const parsed = ReviewSchema.safeParse(outcome.value.structured ?? parseJson(outcome.value.text));
      return parsed.success ? ok(parsed.data) : err(`the reviewer's answer was not usable: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
