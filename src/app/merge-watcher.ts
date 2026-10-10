import type { Vcs } from "../delivery";
import type { EventLog } from "../kernel/events";
import type { OrderService, OrdersProjection } from "../orders";
import type { OrderFlow } from "./order-flow";

export interface MergeWatcherDependencies {
  log: EventLog;
  vcs: Vcs;
  orders: OrdersProjection;
  orderService: OrderService;
  repo: string;
  flow: Pick<OrderFlow, "followUp">;
  progressOf(id: string): { blocked: string | null; checks: string | null };
}

const CONFLICT_INSTRUCTION =
  "Other work was merged into the base branch and this pull request now conflicts with it. Bring the branch up to date and resolve the conflicts, keeping what the merged changes did and what this order asked for.";

export class MergeWatcher {
  private readonly reportedClosed = new Set<string>();
  private readonly syncedAt = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: MergeWatcherDependencies) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => void this.poll(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    const { orders, vcs, repo, orderService, log } = this.deps;
    const inReview = orders.list().filter((order) => order.status === "in_review" && order.pullRequest !== null);

    for (const order of inReview) {
      try {
        const state = await vcs.pullRequestState(repo, order.pullRequest!);
        if (state === "merged") await orderService.deliver(order.id);
        if (state === "open") await this.reportChecks(order.id, order.pullRequest!);
        if (state === "closed" && !this.reportedClosed.has(order.id)) {
          this.reportedClosed.add(order.id);
          await log.record([{ type: "delivery.work_blocked", payload: { orderId: order.id, reason: "the pull request was closed without merging" } }]);
        }
      } catch {
        // GitHub unreachable: the next poll tries again
      }
    }
    await this.syncConflicting();
  }

  private async reportChecks(orderId: string, pullRequest: number): Promise<void> {
    const { vcs, repo, log, progressOf } = this.deps;
    const state = await vcs.pullRequestChecks(repo, pullRequest);
    if (state !== (progressOf(orderId).checks ?? "none")) await log.record([{ type: "delivery.checks_changed", payload: { orderId, state } }]);
  }

  // Once per merge: a worker that cannot resolve the conflict blocks the order and the director takes over.
  private async syncConflicting(): Promise<void> {
    const { orders, vcs, repo, flow, progressOf } = this.deps;
    const merges = orders.list().filter((order) => order.status === "delivered").length;
    const open = orders.list().filter((order) => order.status === "in_review" && order.pullRequest !== null);

    for (const order of open) {
      if ((this.syncedAt.get(order.id) ?? 0) >= merges || progressOf(order.id).blocked !== null) continue;
      try {
        if (!(await vcs.pullRequestConflicts(repo, order.pullRequest!))) continue;
        const started = await flow.followUp(order.id, CONFLICT_INSTRUCTION);
        if (started.ok) this.syncedAt.set(order.id, merges);
      } catch {
        // GitHub unreachable: the next poll tries again
      }
    }
  }
}
