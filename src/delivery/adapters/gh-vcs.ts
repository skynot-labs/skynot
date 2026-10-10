import { exec, run, type Exec } from "../../kernel/process";
import type { ChecksState, IssueRef, NewPullRequest, PullRequestState, Vcs } from "../domain";

interface Created {
  number: number;
  html_url: string;
}

export class GhVcs implements Vcs {
  constructor(private readonly execute: Exec = exec) {}

  async createIssue(repo: string, title: string, body: string): Promise<IssueRef> {
    return this.create(`repos/${repo}/issues`, { title, body });
  }

  async pullRequestState(repo: string, number: number): Promise<PullRequestState> {
    const pull = JSON.parse(await this.api([`repos/${repo}/pulls/${number}`])) as { state: string; merged_at: string | null };
    if (pull.merged_at) return "merged";
    return pull.state === "open" ? "open" : "closed";
  }

  async pullRequestConflicts(repo: string, number: number): Promise<boolean> {
    const pull = JSON.parse(await this.api([`repos/${repo}/pulls/${number}`])) as { mergeable_state: string };
    return pull.mergeable_state === "dirty";
  }

  async pullRequestDiff(repo: string, number: number): Promise<string> {
    return this.api(["-H", "Accept: application/vnd.github.diff", `repos/${repo}/pulls/${number}`]);
  }

  async pullRequestChecks(repo: string, number: number): Promise<ChecksState> {
    const pull = JSON.parse(await this.api([`repos/${repo}/pulls/${number}`])) as { head: { sha: string } };
    // Workflow runs, not check runs: a personal access token has no Checks permission, only Actions.
    const found = JSON.parse(await this.api([`repos/${repo}/actions/runs?head_sha=${pull.head.sha}`])) as {
      workflow_runs: Array<{ status: string; conclusion: string | null }>;
    };
    const runs = found.workflow_runs;
    if (runs.length === 0) return "none";
    if (runs.some((run) => ["failure", "cancelled", "timed_out", "action_required"].includes(run.conclusion ?? ""))) return "failing";
    return runs.every((run) => run.status === "completed") ? "passing" : "pending";
  }

  async commentOnPullRequest(repo: string, number: number, text: string): Promise<void> {
    await this.api(["-X", "POST", `repos/${repo}/issues/${number}/comments`, "-f", `body=${text}`]);
  }

  async addLabel(repo: string, issue: number, label: string): Promise<void> {
    await this.api(["-X", "POST", `repos/${repo}/issues/${issue}/labels`, "-f", `labels[]=${label}`]);
  }

  async openPullRequest(repo: string, pullRequest: NewPullRequest): Promise<IssueRef> {
    const { title, head, base, body } = pullRequest;
    return this.create(`repos/${repo}/pulls`, { title, head, base, body });
  }

  private async create(endpoint: string, fields: Record<string, string>): Promise<IssueRef> {
    const flags = Object.entries(fields).flatMap(([name, value]) => ["-f", `${name}=${value}`]);
    const created = JSON.parse(await this.api(["-X", "POST", endpoint, ...flags])) as Created;
    return { number: created.number, url: created.html_url };
  }

  private api(args: string[]): Promise<string> {
    return run(this.execute, "gh", ["api", ...args]);
  }
}
