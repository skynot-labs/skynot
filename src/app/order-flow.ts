import type { Implementer, IssueFiler, WorkItem } from "../delivery";
import { err, ok, type Result } from "../kernel";
import type { EventLog, StoredEvent } from "../kernel/events";
import { renderCard, type OrderError, type OrderService, type OrderStatus, type WorkOrder } from "../orders";

const RETRYABLE: readonly OrderStatus[] = ["signed", "on_bench"];

export interface OrderFlowDependencies {
  log: EventLog;
  orders: OrderService;
  filer: IssueFiler;
  implementer: Implementer;
  repo: string;
  findOrder(id: string): WorkOrder | undefined;
  progressOf(id: string): { issue: number | null; blocked: string | null };
}

export class OrderFlow {
  private readonly inFlight = new Set<Promise<void>>();
  private readonly running = new Set<string>();

  constructor(private readonly deps: OrderFlowDependencies) {}

  start(): () => void {
    return this.deps.log.subscribe((event) => this.react(event));
  }

  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  async retry(orderId: string): Promise<Result<WorkOrder, OrderError>> {
    const order = this.deps.findOrder(orderId);
    if (!order) return err({ kind: "not_found", message: `no order ${orderId}` });
    if (!RETRYABLE.includes(order.status) || this.deps.progressOf(orderId).blocked === null) {
      return err({ kind: "invalid_transition", message: `${orderId} is not blocked` });
    }
    if (this.running.has(orderId)) return err({ kind: "invalid_transition", message: `${orderId} is already being worked` });

    this.running.add(orderId);
    try {
      await this.deps.log.record([{ type: "delivery.work_retried", payload: { orderId } }]);
    } catch (error) {
      this.running.delete(orderId);
      throw error;
    }
    this.launch(orderId);
    return ok(order);
  }

  private react(event: StoredEvent): void {
    if (event.type !== "orders.signed") return;

    this.launch((event.payload as { orderId: string }).orderId);
  }

  private launch(orderId: string): void {
    this.running.add(orderId);
    const run = this.run(orderId).finally(() => {
      this.inFlight.delete(run);
      this.running.delete(orderId);
    });
    this.inFlight.add(run);
  }

  private async run(orderId: string): Promise<void> {
    const { orders, filer, implementer, repo, findOrder, progressOf, log } = this.deps;
    try {
      const order = findOrder(orderId);
      if (!order) return;
      const item = toWorkItem(order);

      let issue = progressOf(orderId).issue;
      if (issue === null) {
        const filed = await filer.file(item, repo);
        if (!filed.ok) return;
        issue = filed.value.number;
      }

      if (order.status === "signed") {
        const started = await orders.startWork(orderId);
        if (!started.ok) return;
      }

      const pullRequest = await implementer.implement(item, repo, issue);
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
