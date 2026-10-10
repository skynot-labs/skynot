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

interface Job {
  item: WorkItem;
  repoName: string;
  issue: number;
  repo: RepoRules;
  branch: string;
  dir: string;
}

type Verified = Job & { report: string };

export class Implementer {
  constructor(private readonly deps: ImplementerDependencies) {}

  async implement(item: WorkItem, repoName: string, issue: number): Promise<Result<IssueRef, string>> {
    const outcome = await this.attempt(item, repoName, issue, undefined, async (job) => {
      const pushed = await this.commitAndPush(job);
      if (!pushed.ok) return pushed;
      return ok(
        await this.deps.vcs.openPullRequest(repoName, {
          head: job.branch,
          base: job.repo.baseBranch,
          title: issueTitle(item),
          body: pullRequestBody(item, issue, job.report),
        }),
      );
    });
    const event = outcome.ok
      ? { type: "delivery.pull_request_opened", payload: { orderId: item.id, repo: repoName, number: outcome.value.number, url: outcome.value.url } }
      : { type: "delivery.work_blocked", payload: { orderId: item.id, reason: outcome.error } };
    await this.deps.log.record([event]);
    return outcome;
  }

  async followUp(item: WorkItem, repoName: string, issue: number, pullRequest: number, instruction: string): Promise<Result<void, string>> {
    const outcome = await this.attempt(item, repoName, issue, instruction, (job) => this.commitAndPush(job));
    const event = outcome.ok
      ? { type: "delivery.pull_request_updated", payload: { orderId: item.id, number: pullRequest } }
      : { type: "delivery.work_blocked", payload: { orderId: item.id, reason: outcome.error } };
    await this.deps.log.record([event]);
    return outcome;
  }

  private async attempt<T>(
    item: WorkItem,
    repoName: string,
    issue: number,
    followUp: string | undefined,
    publish: (job: Verified) => Promise<Result<T, string>>,
  ): Promise<Result<T, string>> {
    const { rules, workspace } = this.deps;

    const repo = rules.repo(repoName);
    if (!repo.ok) return repo;
    const branch = rules.branchFor(item.id);
    if (!branch.ok) return branch;

    let dir: string;
    try {
      const prepare = followUp ? workspace.prepareFollowUp : workspace.prepare;
      dir = await prepare.call(workspace, repoName, repo.value.baseBranch, branch.value);
    } catch (error) {
      return err(`could not prepare a workspace: ${(error as Error).message}`);
    }

    try {
      const job = { item, repoName, issue, repo: repo.value, branch: branch.value, dir };
      const report = await this.work(job, followUp);
      return report.ok ? await publish({ ...job, report: report.value }) : report;
    } catch (error) {
      return err((error as Error).message);
    } finally {
      await workspace.drop(repoName, dir).catch(() => undefined);
    }
  }

  private async work(job: Job, followUp: string | undefined): Promise<Result<string, string>> {
    const { item, repoName, issue, repo, dir } = job;
    const { rules, workspace, worker } = this.deps;

    if (repo.setupCommand) {
      const setup = await workspace.run(dir, repo.setupCommand, COMMAND_TIMEOUT_MS);
      if (!setup.ok) return err(`setup failed: ${tail(setup.output)}`);
    }

    let failure: string | undefined;
    let report = "";
    for (let round = 1; round <= rules.maxRounds; round++) {
      const prompt = workerPrompt(item, issue, { protectedPaths: repo.protectedPaths, verifyCommands: repo.verifyCommands }, failure, followUp);
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

      failure = await this.verify(dir, repo, followUp !== undefined);
      if (!failure) break;
    }
    if (failure) return err(`verification still fails after ${rules.maxRounds} rounds: ${tail(failure)}`);
    return ok(report);
  }

  private async commitAndPush({ item, issue, branch, dir }: Job): Promise<Result<void, string>> {
    const { rules, workspace } = this.deps;
    const spent = await rules.spend(item.id);
    if (!spent.ok) return spent;
    await workspace.commit(dir, `${item.id}: ${item.title}\n\nCloses #${issue}`);
    await workspace.push(dir, branch);
    return ok(undefined);
  }

  private async verify(dir: string, repo: RepoRules, checkConflictMarkers: boolean): Promise<string | undefined> {
    if (checkConflictMarkers) {
      // passes only when git grep exits 1, so an error in the check itself also counts as a failure
      const markers = await this.deps.workspace.run(dir, "git grep --untracked -n -I -E '^(<<<<<<<|>>>>>>>) '; test $? -eq 1", COMMAND_TIMEOUT_MS);
      if (!markers.ok) return `unresolved conflict markers:\n${tail(markers.output, 1500)}`;
    }
    for (const command of repo.verifyCommands) {
      const result = await this.deps.workspace.run(dir, command, COMMAND_TIMEOUT_MS);
      if (!result.ok) return `$ ${command}\n${tail(result.output, 1500)}`;
    }
    return undefined;
  }
}

const tail = (text: string, length = 400): string => text.trim().slice(-length);
