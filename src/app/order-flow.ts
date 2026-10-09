import type { Implementer, IssueFiler, WorkItem } from "../delivery";
import type { EventLog, StoredEvent } from "../kernel/events";
import { renderCard, type OrderService, type WorkOrder } from "../orders";

export interface OrderFlowDependencies {
  log: EventLog;
  orders: OrderService;
  filer: IssueFiler;
  implementer: Implementer;
  repo: string;
  findOrder(id: string): WorkOrder | undefined;
}

export class OrderFlow {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly deps: OrderFlowDependencies) {}

  start(): () => void {
    return this.deps.log.subscribe((event) => this.react(event));
  }

  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  private react(event: StoredEvent): void {
    if (event.type !== "orders.signed") return;

    const { orderId } = event.payload as { orderId: string };
    const run = this.run(orderId).finally(() => this.inFlight.delete(run));
    this.inFlight.add(run);
  }

  private async run(orderId: string): Promise<void> {
    const { orders, filer, implementer, repo, findOrder, log } = this.deps;
    try {
      const order = findOrder(orderId);
      if (!order) return;
      const item = toWorkItem(order);

      const issue = await filer.file(item, repo);
      if (!issue.ok) return;

      const started = await orders.startWork(orderId);
      if (!started.ok) return;

      const pullRequest = await implementer.implement(item, repo, issue.value.number);
      if (!pullRequest.ok) return;

      await orders.openPullRequest(orderId, pullRequest.value.number);
    } catch (error) {
      await log.record([{ type: "delivery.work_blocked", payload: { orderId, reason: (error as Error).message } }]);
    }
  }
}

export function toWorkItem(order: WorkOrder): WorkItem {
  const { spec } = order;
  return {
    id: order.id,
    title: spec.title,
    objective: spec.objective,
    criteria: spec.acceptanceCriteria,
    outOfScope: spec.outOfScope,
    risk: spec.risk,
    likelyFiles: spec.likelyFiles,
    card: renderCard(order),
  };
}
