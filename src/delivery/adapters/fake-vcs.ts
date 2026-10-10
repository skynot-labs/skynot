import type { IssueRef, NewPullRequest, PullRequestState, Vcs } from "../domain";

export interface FakeIssue {
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface FakePullRequest extends NewPullRequest {
  repo: string;
  number: number;
  url: string;
}

export class FakeVcs implements Vcs {
  readonly issues: FakeIssue[] = [];
  readonly pullRequests: FakePullRequest[] = [];
  private nextNumber = 1;
  private readonly conflicting = new Set<string>();
  private readonly states = new Map<string, PullRequestState>();

  async createIssue(repo: string, title: string, body: string): Promise<IssueRef> {
    const number = this.nextNumber++;
    this.issues.push({ repo, number, title, body, labels: [] });
    return { number, url: `https://github.com/${repo}/issues/${number}` };
  }

  async pullRequestState(repo: string, number: number): Promise<PullRequestState> {
    return this.states.get(`${repo}#${number}`) ?? "open";
  }

  async pullRequestConflicts(repo: string, number: number): Promise<boolean> {
    return this.conflicting.has(`${repo}#${number}`);
  }

  setConflicts(repo: string, number: number, conflicts: boolean): void {
    if (conflicts) this.conflicting.add(`${repo}#${number}`);
    else this.conflicting.delete(`${repo}#${number}`);
  }

  setPullRequestState(repo: string, number: number, state: PullRequestState): void {
    this.states.set(`${repo}#${number}`, state);
  }

  async addLabel(repo: string, issue: number, label: string): Promise<void> {
    const found = this.issues.find((candidate) => candidate.repo === repo && candidate.number === issue);
    if (!found) throw new Error(`no issue #${issue} in ${repo}`);
    found.labels.push(label);
  }

  async openPullRequest(repo: string, pullRequest: NewPullRequest): Promise<IssueRef> {
    const number = this.nextNumber++;
    const url = `https://github.com/${repo}/pull/${number}`;
    this.pullRequests.push({ ...pullRequest, repo, number, url });
    return { number, url };
  }
}
