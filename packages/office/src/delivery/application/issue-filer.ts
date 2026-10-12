import { err, ok, type Result } from "../../kernel";
import type { EventLog } from "../../kernel/events";
import { issueBody, issueTitle, type DeliveryRules, type IssueRef, type Vcs, type WorkItem } from "../domain";

export interface IssueFilerDependencies {
  log: EventLog;
  vcs: Vcs;
  rules: DeliveryRules;
}

export class IssueFiler {
  constructor(private readonly deps: IssueFilerDependencies) {}

  async file(item: WorkItem, repoName: string): Promise<Result<IssueRef, string>> {
    const outcome = await this.attempt(item, repoName);
    if (!outcome.ok) {
      await this.deps.log.record([{ type: "delivery.work_blocked", payload: { orderId: item.id, reason: outcome.error } }]);
    }
    return outcome;
  }

  private async attempt(item: WorkItem, repoName: string): Promise<Result<IssueRef, string>> {
    const { log, vcs, rules } = this.deps;

    const repo = rules.repo(repoName);
    if (!repo.ok) return repo;
    const label = rules.triggerLabel();
    if (!label.ok) return label;

    try {
      const firstWrite = await rules.spend(item.id);
      if (!firstWrite.ok) return firstWrite;
      const issue = await vcs.createIssue(repoName, issueTitle(item), issueBody(item));
      await log.record([{ type: "delivery.issue_opened", payload: { orderId: item.id, repo: repoName, issue: issue.number, url: issue.url } }]);

      const secondWrite = await rules.spend(item.id);
      if (!secondWrite.ok) return secondWrite;
      await vcs.addLabel(repoName, issue.number, label.value);
      return ok(issue);
    } catch (error) {
      return err(`GitHub refused: ${(error as Error).message}`);
    }
  }
}
