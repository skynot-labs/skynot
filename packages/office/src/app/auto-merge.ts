import type { LocalMerge, Vcs } from "../delivery";
import { DEFAULT_MAX_CHANGED_LINES, changedLines, holdReason } from "../governance";
import type { EventLog, StoredEvent } from "../kernel/events";
import type { WorkOrder } from "../orders";
import type { Project } from "../projects";

export interface AutoMergeDependencies {
  log: EventLog;
  vcs: Pick<Vcs, "pullRequestDiff" | "pullRequestConflicts">;
  findOrder(orderId: string): WorkOrder | undefined;
  projectOf(order: WorkOrder): Project;
  verifyCommandsOf(project: Project): readonly string[];
  paused(projectId: string): boolean;
  builtOnBase(repo: string, pullRequest: number): Promise<boolean>;
  merge(repo: string, pullRequest: number): Promise<LocalMerge>;
  // Lets the merge watcher deliver the order the merge just landed.
  delivered(): Promise<void>;
  say(text: string, orderId: string): Promise<void>;
  onError?: (error: unknown, event: StoredEvent) => void;
}

// A project that opted in has an approved low-risk order merged by the rule in Governance, not by the director (ADR 0005).
export class AutoMerge {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: AutoMergeDependencies) {}

  start(): () => void {
    return this.deps.log.subscribe((event) => {
      if (event.type !== "delivery.review_completed") return;
      const { orderId, verdict, diffOnly } = event.payload as { orderId: string; verdict: string; diffOnly?: boolean };
      this.queue = this.queue.then(() => this.consider(orderId, { verdict, diffOnly: diffOnly === true })).catch((error) => this.deps.onError?.(error, event));
    });
  }

  idle(): Promise<unknown> {
    return this.queue;
  }

  private async consider(orderId: string, review: { verdict: string; diffOnly: boolean }): Promise<void> {
    const { log, vcs } = this.deps;
    const order = this.deps.findOrder(orderId);
    if (order?.status !== "in_review" || order.pullRequest === null) return;
    const project = this.deps.projectOf(order);
    const rule = project.autoMerge;
    if (!rule || !project.local) return;

    const hold = (reason: string) => log.record([{ type: "delivery.auto_merge_held", payload: { orderId, reason } }]);
    if (this.deps.paused(project.id)) return void (await hold("the project is paused"));

    const diff = await vcs.pullRequestDiff(project.repo, order.pullRequest);
    const reason = holdReason(
      { maxChangedLines: rule.maxChangedLines ?? DEFAULT_MAX_CHANGED_LINES, never: rule.never },
      {
        review,
        risk: order.spec.risk,
        verifyCommands: this.deps.verifyCommandsOf(project),
        upToDate: await this.deps.builtOnBase(project.repo, order.pullRequest),
        conflicts: await vcs.pullRequestConflicts(project.repo, order.pullRequest),
        diff,
        protectedPaths: project.protectedPaths,
      },
    );
    if (reason) return void (await hold(reason));

    const merged = await this.deps.merge(project.repo, order.pullRequest);
    if (merged !== "merged") return void (await hold(merged === "conflicts" ? "it conflicts with the base branch" : "its pull request is no longer open"));
    const lines = changedLines(diff);
    await log.record([{ type: "delivery.auto_merged", payload: { orderId, lines } }]);
    await this.deps.delivered();
    await this.deps.say(`${orderId} merged on its own: the reviewer approved it, its risk is low and it changes ${lines} ${lines === 1 ? "line" : "lines"}, nothing sensitive.`, orderId);
  }
}
