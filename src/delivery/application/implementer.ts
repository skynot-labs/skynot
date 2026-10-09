import { err, ok, type Result } from "../../kernel";
import type { EventLog } from "../../kernel/events";
import {
  deletedTest,
  issueTitle,
  pullRequestBody,
  workerPrompt,
  type DeliveryRules,
  type IssueRef,
  type RepoRules,
  type Vcs,
  type WorkItem,
  type Workspace,
  type WorkerRunner,
} from "../domain";

const COMMAND_TIMEOUT_MS = 600_000;
const ALWAYS_ALLOWED = ["git status", "git diff *"];

export interface ImplementerDependencies {
  log: EventLog;
  vcs: Vcs;
  workspace: Workspace;
  worker: WorkerRunner;
  rules: DeliveryRules;
}

export class Implementer {
  constructor(private readonly deps: ImplementerDependencies) {}

  async implement(item: WorkItem, repoName: string, issue: number): Promise<Result<IssueRef, string>> {
    const outcome = await this.attempt(item, repoName, issue);
    const event = outcome.ok
      ? { type: "delivery.pull_request_opened", payload: { orderId: item.id, repo: repoName, number: outcome.value.number, url: outcome.value.url } }
      : { type: "delivery.work_blocked", payload: { orderId: item.id, reason: outcome.error } };
    await this.deps.log.record([event]);
    return outcome;
  }

  private async attempt(item: WorkItem, repoName: string, issue: number): Promise<Result<IssueRef, string>> {
    const { rules, workspace } = this.deps;

    const repo = rules.repo(repoName);
    if (!repo.ok) return repo;
    const branch = rules.branchFor(item.id);
    if (!branch.ok) return branch;

    let dir: string;
    try {
      dir = await workspace.prepare(repoName, repo.value.baseBranch, branch.value);
    } catch (error) {
      return err(`could not prepare a workspace: ${(error as Error).message}`);
    }

    try {
      return await this.work({ item, repoName, issue, repo: repo.value, branch: branch.value, dir });
    } catch (error) {
      return err((error as Error).message);
    } finally {
      await workspace.drop(repoName, dir).catch(() => undefined);
    }
  }

  private async work(job: { item: WorkItem; repoName: string; issue: number; repo: RepoRules; branch: string; dir: string }): Promise<Result<IssueRef, string>> {
    const { item, repoName, issue, repo, branch, dir } = job;
    const { rules, workspace, worker, vcs } = this.deps;

    if (repo.setupCommand) {
      const setup = await workspace.run(dir, repo.setupCommand, COMMAND_TIMEOUT_MS);
      if (!setup.ok) return err(`setup failed: ${tail(setup.output)}`);
    }

    let failure: string | undefined;
    let report = "";
    for (let round = 1; round <= rules.maxRounds; round++) {
      const prompt = workerPrompt(item, issue, { protectedPaths: repo.protectedPaths, verifyCommands: repo.verifyCommands }, failure);
      const done = await worker.work({
        orderId: item.id,
        prompt,
        cwd: dir,
        allowedCommands: [...repo.verifyCommands, ...ALWAYS_ALLOWED],
        timeoutMs: rules.workerTimeoutMs,
        maxUsd: rules.workerMaxUsd,
      });
      if (!done.ok) return err(`the worker failed: ${done.error}`);
      report = done.value.report.trim();

      const changes = await workspace.changes(dir);
      if (changes.length === 0) return err("the worker changed nothing");
      const [touched] = rules.protectedTouched(repoName, changes.map((change) => change.path));
      if (touched) return err(`it touches ${touched}, which needs the director's signature`);
      const removed = deletedTest(changes);
      if (removed) return err(`it deletes the test ${removed}`);

      failure = await this.verify(dir, repo);
      if (!failure) break;
    }
    if (failure) return err(`verification still fails after ${rules.maxRounds} rounds: ${tail(failure)}`);

    const spent = await rules.spend(item.id);
    if (!spent.ok) return spent;
    await workspace.commit(dir, `${item.id}: ${item.title}\n\nCloses #${issue}`);
    await workspace.push(dir, branch);
    const pullRequest = await vcs.openPullRequest(repoName, {
      head: branch,
      base: repo.baseBranch,
      title: issueTitle(item),
      body: pullRequestBody(item, issue, report),
    });
    return ok(pullRequest);
  }

  private async verify(dir: string, repo: RepoRules): Promise<string | undefined> {
    for (const command of repo.verifyCommands) {
      const result = await this.deps.workspace.run(dir, command, COMMAND_TIMEOUT_MS);
      if (!result.ok) return `$ ${command}\n${tail(result.output, 1500)}`;
    }
    return undefined;
  }
}

const tail = (text: string, length = 400): string => text.trim().slice(-length);
