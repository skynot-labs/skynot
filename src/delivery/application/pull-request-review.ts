import { err, ok, type Result } from "../../kernel";
import type { EventLog } from "../../kernel/events";
import { reviewComment, type CodeReviewer, type Review, type Vcs, type WorkItem } from "../domain";

export interface PullRequestReviewDependencies {
  log: EventLog;
  vcs: Vcs;
  reviewer: CodeReviewer;
}

export class PullRequestReview {
  constructor(private readonly deps: PullRequestReviewDependencies) {}

  async run(item: WorkItem, repo: string, pullRequest: number, round: number, signal?: AbortSignal): Promise<Result<Review, string>> {
    const { log, vcs, reviewer } = this.deps;
    try {
      const diff = await vcs.pullRequestDiff(repo, pullRequest);
      const outcome = await reviewer.review({ item, diff, ...(signal && { signal }) });
      if (!outcome.ok) return await this.failed(item.id, outcome.error);

      const { verdict, summary, findings } = outcome.value;
      await log.record([{ type: "delivery.review_completed", payload: { orderId: item.id, round, verdict, summary, findings } }]);
      await vcs.commentOnPullRequest(repo, pullRequest, reviewComment(outcome.value, round)).catch(() => undefined);
      return ok(outcome.value);
    } catch (error) {
      return this.failed(item.id, (error as Error).message);
    }
  }

  private async failed(orderId: string, reason: string): Promise<Result<Review, string>> {
    await this.deps.log.record([{ type: "delivery.review_failed", payload: { orderId, reason } }]);
    return err(reason);
  }
}
