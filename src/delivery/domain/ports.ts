import type { Result } from "../../kernel";
import type { FileChange } from "./work-item";

export interface IssueRef {
  readonly number: number;
  readonly url: string;
}

export interface NewPullRequest {
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

export type PullRequestState = "open" | "merged" | "closed";

export interface Vcs {
  createIssue(repo: string, title: string, body: string): Promise<IssueRef>;
  pullRequestState(repo: string, number: number): Promise<PullRequestState>;
  pullRequestConflicts(repo: string, number: number): Promise<boolean>;
  addLabel(repo: string, issue: number, label: string): Promise<void>;
  openPullRequest(repo: string, pullRequest: NewPullRequest): Promise<IssueRef>;
}

export interface CommandOutcome {
  readonly ok: boolean;
  readonly output: string;
}

export interface Workspace {
  readingCopy(repo: string, baseBranch: string): Promise<string>;
  prepare(repo: string, baseBranch: string, branch: string): Promise<string>;
  prepareFollowUp(repo: string, baseBranch: string, branch: string): Promise<string>;
  changes(dir: string): Promise<FileChange[]>;
  commit(dir: string, message: string): Promise<void>;
  push(dir: string, branch: string): Promise<void>;
  drop(repo: string, dir: string): Promise<void>;
  run(dir: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandOutcome>;
}

export interface WorkerRunner {
  work(input: {
    orderId: string;
    prompt: string;
    cwd: string;
    allowedCommands: string[];
    timeoutMs: number;
    maxUsd: number;
    signal?: AbortSignal;
  }): Promise<Result<{ report: string; costUsd: number }, string>>;
}

export interface RepoRules {
  readonly baseBranch: string;
  readonly setupCommand: string | null;
  readonly verifyCommands: readonly string[];
  readonly protectedPaths: readonly string[];
}

export interface DeliveryRules {
  readonly maxRounds: number;
  readonly workerTimeoutMs: number;
  readonly workerMaxUsd: number;
  repo(name: string): Result<RepoRules, string>;
  branchFor(orderId: string): Result<string, string>;
  triggerLabel(): Result<string, string>;
  protectedTouched(repo: string, paths: readonly string[]): string[];
  spend(orderId: string): Promise<Result<void, string>>;
}
