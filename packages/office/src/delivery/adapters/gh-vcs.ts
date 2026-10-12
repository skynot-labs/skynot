import { exec, run, type Exec } from "../../kernel/process";
import type { ChecksState, IssueRef, Ticket, NewPullRequest, PullRequestState, Vcs } from "../domain";

interface Created {
  number: number;
  html_url: string;
}

const PASSING_CONCLUSIONS = ["success", "skipped", "neutral"];

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
    const finished = runs.filter((run) => run.status === "completed");
    if (finished.some((run) => !PASSING_CONCLUSIONS.includes(run.conclusion ?? ""))) return "failing";
    return finished.length === runs.length ? "passing" : "pending";
  }

  async commentOnPullRequest(repo: string, number: number, text: string): Promise<void> {
    await this.api(["-X", "POST", `repos/${repo}/issues/${number}/comments`, "-f", `body=${text}`]);
  }

  async listTickets(repo: string, label: string): Promise<Ticket[]> {
    const issues = JSON.parse(await this.api([`repos/${repo}/issues?state=open&per_page=30&labels=${encodeURIComponent(label)}`])) as Array<{
      number: number;
      title: string;
      body: string | null;
      html_url: string;
      pull_request?: unknown;
    }>;
    return issues.filter((issue) => !issue.pull_request).map((issue) => ({ number: issue.number, title: issue.title, body: issue.body ?? "", url: issue.html_url }));
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
