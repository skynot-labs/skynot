import type { IssueRef, NewPullRequest, Vcs } from "../domain";

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

  async createIssue(repo: string, title: string, body: string): Promise<IssueRef> {
    const number = this.nextNumber++;
    this.issues.push({ repo, number, title, body, labels: [] });
    return { number, url: `https://github.com/${repo}/issues/${number}` };
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
