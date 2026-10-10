import type { Vcs } from "../delivery";
import type { EventLog } from "../kernel/events";
import type { OrderService, OrdersProjection, WorkOrder } from "../orders";
import type { OrderFlow } from "./order-flow";

export interface MergeWatcherDependencies {
  log: EventLog;
  vcs: Vcs;
  orders: OrdersProjection;
  orderService: OrderService;
  repoOf(order: WorkOrder): string;
  flow: Pick<OrderFlow, "followUp">;
  progressOf(id: string): { blocked: string | null; checks: string | null };
}

const CONFLICT_INSTRUCTION =
  "Other work was merged into the base branch and this pull request now conflicts with it. Bring the branch up to date and resolve the conflicts, keeping what the merged changes did and what this order asked for.";

const CLOSED_UNMERGED = "the pull request was closed without merging";

export class MergeWatcher {
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
    const { orders, vcs, repoOf, orderService, log, progressOf } = this.deps;
    const inReview = orders.list().filter((order) => order.status === "in_review" && order.pullRequest !== null);

    for (const order of inReview) {
      try {
        const state = await vcs.pullRequestState(repoOf(order), order.pullRequest!);
        if (state === "merged") await orderService.deliver(order.id);
        if (state === "open") await this.reportChecks(order, order.pullRequest!);
        if (state === "closed" && progressOf(order.id).blocked !== CLOSED_UNMERGED) {
          await log.record([{ type: "delivery.work_blocked", payload: { orderId: order.id, reason: CLOSED_UNMERGED } }]);
        }
      } catch {
        // GitHub unreachable: the next poll tries again
      }
    }
    await this.syncConflicting();
  }

  private async reportChecks(order: WorkOrder, pullRequest: number): Promise<void> {
    const { vcs, repoOf, log, progressOf } = this.deps;
    const orderId = order.id;
    const state = await vcs.pullRequestChecks(repoOf(order), pullRequest);
    if (state !== progressOf(orderId).checks) await log.record([{ type: "delivery.checks_changed", payload: { orderId, state } }]);
  }

  // Once per merge: a worker that cannot resolve the conflict blocks the order and the director takes over.
  private async syncConflicting(): Promise<void> {
    const { orders, vcs, repoOf, flow, progressOf } = this.deps;
    // a merge only moves the base of its own project
    const mergesIn = (projectId: string) => orders.list().filter((order) => order.status === "delivered" && order.projectId === projectId).length;
    const open = orders.list().filter((order) => order.status === "in_review" && order.pullRequest !== null);

    for (const order of open) {
      const merges = mergesIn(order.projectId);
      if ((this.syncedAt.get(order.id) ?? 0) >= merges || progressOf(order.id).blocked !== null) continue;
      try {
        if (!(await vcs.pullRequestConflicts(repoOf(order), order.pullRequest!))) continue;
        const started = await flow.followUp(order.id, CONFLICT_INSTRUCTION);
        if (started.ok) this.syncedAt.set(order.id, merges);
      } catch {
        // GitHub unreachable: the next poll tries again
      }
    }
  }
}
