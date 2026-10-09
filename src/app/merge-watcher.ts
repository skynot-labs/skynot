import type { Vcs } from "../delivery";
import type { EventLog } from "../kernel/events";
import type { OrderService, OrdersProjection } from "../orders";

export interface MergeWatcherDependencies {
  log: EventLog;
  vcs: Vcs;
  orders: OrdersProjection;
  orderService: OrderService;
  repo: string;
}

export class MergeWatcher {
  private readonly reportedClosed = new Set<string>();
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
        if (state === "closed" && !this.reportedClosed.has(order.id)) {
          this.reportedClosed.add(order.id);
          await log.record([{ type: "delivery.work_blocked", payload: { orderId: order.id, reason: "the pull request was closed without merging" } }]);
        }
      } catch {
        // GitHub unreachable: the next poll tries again
      }
    }
  }
}
