import { REVIEW_SYSTEM, readReview, reviewPrompt, reviewSchemaFor, type CodeReviewer } from "../delivery";
import { toEngineSchema, type EngineName, type RunScheduler } from "../execution";
import { err, ok } from "../kernel";

export interface CodeReviewerOptions {
  engine: EngineName;
  cwd: () => Promise<string>;
  timeoutMs: number;
  model?: string;
  maxUsd?: number;
  projectId?: string;
  // True where the engine cannot read the repository or run commands, so it sees only what the prompt carries.
  diffOnly?: () => boolean;
}

export function createCodeReviewer(scheduler: RunScheduler, options: CodeReviewerOptions): CodeReviewer {
  return {
    async review({ item, diff, earlier = [], signal }) {
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
          prompt: reviewPrompt(item, diff, earlier),
          system: REVIEW_SYSTEM,
          cwd,
          access: "read",
          schema: toEngineSchema(reviewSchemaFor(earlier)),
          timeoutMs: options.timeoutMs,
          ...(signal && { signal }),
          ...(options.model && { model: options.model }),
          ...(options.maxUsd && { maxUsd: options.maxUsd }),
        },
      });
      if (!outcome.ok) return err(outcome.error.message);

      const review = readReview(outcome.value.structured ?? parseJson(outcome.value.text), earlier);
      return review.ok ? ok({ ...review.value, ...(options.diffOnly?.() && { diffOnly: true }) }) : err(`the reviewer's answer was not usable: ${review.error}`);
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
