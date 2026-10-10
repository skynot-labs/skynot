import { exec, run, type Exec } from "../../kernel/process";
import type { IssueRef, NewPullRequest, PullRequestState, Vcs } from "../domain";

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
