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
  askedQuestion,
} from "../domain";

const COMMAND_TIMEOUT_MS = 600_000;
const ALWAYS_ALLOWED = ["git status", "git diff *"];
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const STOPPED = "stopped by the director";
const ASKS = "the worker asks: ";

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
  approved: readonly string[];
  signal: AbortSignal | undefined;
}

type Verified = Job & { report: string };

export class Implementer {
  constructor(private readonly deps: ImplementerDependencies) {}

  async implement(item: WorkItem, repoName: string, issue: number, approved: readonly string[] = [], signal?: AbortSignal): Promise<Result<IssueRef, string>> {
    const outcome = await this.attempt(item, repoName, issue, undefined, approved, signal, async (job) => {
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
      : failureEvent(item.id, outcome.error);
    await this.deps.log.record([event]);
    return outcome;
  }

  async followUp(item: WorkItem, repoName: string, issue: number, pullRequest: number, instruction: string, approved: readonly string[] = [], signal?: AbortSignal): Promise<Result<void, string>> {
    const outcome = await this.attempt(item, repoName, issue, instruction, approved, signal, (job) => this.commitAndPush(job));
    const event = outcome.ok
      ? { type: "delivery.pull_request_updated", payload: { orderId: item.id, number: pullRequest } }
      : failureEvent(item.id, outcome.error);
    await this.deps.log.record([event]);
    return outcome;
  }

  private async attempt<T>(
    item: WorkItem,
    repoName: string,
    issue: number,
    followUp: string | undefined,
    approved: readonly string[],
    signal: AbortSignal | undefined,
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
      const job = { item, repoName, issue, repo: repo.value, branch: branch.value, dir, approved, signal };
      const report = await this.work(job, followUp);
      return report.ok ? await publish({ ...job, report: report.value }) : report;
    } catch (error) {
      return err((error as Error).message);
    } finally {
      await workspace.drop(repoName, dir).catch(() => undefined);
    }
  }

  private async work(job: Job, followUp: string | undefined): Promise<Result<string, string>> {
    const { item, issue, repo, dir, signal } = job;
    const { rules, workspace, worker } = this.deps;

    if (repo.setupCommand) {
      const setup = await workspace.run(dir, repo.setupCommand, COMMAND_TIMEOUT_MS, signal);
      if (signal?.aborted) return err(STOPPED);
      if (!setup.ok) return err(`setup failed: ${tail(setup.output)}`);
    }
    const installFailed = await this.install(job);
    if (signal?.aborted) return err(STOPPED);
    if (installFailed) return err(installFailed);
    const signedDependencies = await this.dependenciesIn(dir);

    let failure: string | undefined;
    let report = "";
    for (let round = 1; round <= rules.maxRounds; round++) {
      if (signal?.aborted) return err(STOPPED);
      const prompt = workerPrompt(item, issue, { protectedPaths: repo.protectedPaths, verifyCommands: repo.verifyCommands }, failure, followUp);
      const done = await worker.work({
        orderId: item.id,
        prompt,
        cwd: dir,
        allowedCommands: [...repo.verifyCommands, ...ALWAYS_ALLOWED],
        timeoutMs: rules.workerTimeoutMs,
        maxUsd: rules.workerMaxUsd,
        ...(signal && { signal }),
      });
      if (signal?.aborted) return err(STOPPED);
      if (!done.ok) return err(`the worker failed: ${done.error}`);
      report = done.value.report.trim();
      const question = askedQuestion(report);
      if (question) return err(`${ASKS}${question}`);

      const refused = await this.refusal(job, signedDependencies);
      if (refused) return err(refused);

      failure = await this.verify(dir, repo, followUp !== undefined, signal);
      if (signal?.aborted) return err(STOPPED);
      if (failure) continue;

      // the verify commands run the worker's code, which can write what the first look did not see
      const refusedAfterVerify = await this.refusal(job, signedDependencies);
      if (refusedAfterVerify) return err(refusedAfterVerify);
      break;
    }
    if (failure) return err(`verification still fails after ${rules.maxRounds} rounds: ${tail(failure)}`);
    return ok(report);
  }

  private async refusal({ item, repoName, dir, approved }: Job, signedDependencies: ReadonlySet<string>): Promise<string | undefined> {
    const { rules, workspace, log } = this.deps;
    const changes = await workspace.changes(dir);
    if (changes.length === 0) return "the worker changed nothing";
    const touched = rules.protectedTouched(repoName, changes.map((change) => change.path)).filter((path) => !approved.includes(path));
    if (touched.length > 0) {
      await log.record([{ type: "delivery.protected_paths_found", payload: { orderId: item.id, paths: touched } }]);
      return `it touches ${touched.join(", ")}, which is protected`;
    }
    const removed = deletedTest(changes);
    if (removed) return `it deletes the test ${removed}`;
    const added = [...(await this.dependenciesIn(dir))].filter((name) => !signedDependencies.has(name));
    return added.length > 0 ? `it adds ${added.join(", ")} to the dependencies, which the order did not declare` : undefined;
  }

  private async install({ item, repo, dir, signal }: Job): Promise<string | undefined> {
    for (const dev of [false, true]) {
      const names = (item.dependencies ?? []).filter((dependency) => dependency.dev === dev).map((dependency) => dependency.name);
      if (names.length === 0) continue;
      const installed = await this.deps.workspace.run(dir, [repo.installCommand, ...(dev ? ["--save-dev"] : []), ...names].join(" "), COMMAND_TIMEOUT_MS, signal);
      if (!installed.ok) return `installing ${names.join(", ")} failed: ${tail(installed.output)}`;
    }
    return undefined;
  }

  private async dependenciesIn(dir: string): Promise<Set<string>> {
    const source = await this.deps.workspace.read(dir, "package.json");
    if (source === null) return new Set();
    try {
      const manifest = JSON.parse(source) as Record<string, unknown>;
      return new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys((manifest[field] as object | undefined) ?? {})));
    } catch {
      // a manifest the worker broke fails verification on its own
      return new Set();
    }
  }

  private async commitAndPush({ item, issue, branch, dir, signal }: Job): Promise<Result<void, string>> {
    const { rules, workspace } = this.deps;
    if (signal?.aborted) return err(STOPPED);
    const spent = await rules.spend(item.id);
    if (!spent.ok) return spent;
    await workspace.commit(dir, `${item.id}: ${item.title}\n\nCloses #${issue}`);
    await workspace.push(dir, branch);
    return ok(undefined);
  }

  private async verify(dir: string, repo: RepoRules, checkConflictMarkers: boolean, signal?: AbortSignal): Promise<string | undefined> {
    if (checkConflictMarkers) {
      // passes only when git grep exits 1, so an error in the check itself also counts as a failure
      const markers = await this.deps.workspace.run(dir, "git grep --untracked -n -I -E '^(<<<<<<<|>>>>>>>) '; test $? -eq 1", COMMAND_TIMEOUT_MS, signal);
      if (!markers.ok) return `unresolved conflict markers:\n${tail(markers.output, 1500)}`;
    }
    for (const command of repo.verifyCommands) {
      const result = await this.deps.workspace.run(dir, command, COMMAND_TIMEOUT_MS, signal);
      if (!result.ok) return `$ ${command}\n${tail(result.output, 1500)}`;
    }
    return undefined;
  }
}

// A worker that stops to ask is waiting for the director, not blocked.
function failureEvent(orderId: string, error: string) {
  return error.startsWith(ASKS)
    ? { type: "delivery.question_raised", payload: { orderId, question: error.slice(ASKS.length) } }
    : { type: "delivery.work_blocked", payload: { orderId, reason: error } };
}

const tail = (text: string, length = 400): string => text.trim().slice(-length);
