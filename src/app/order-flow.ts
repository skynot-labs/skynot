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
  progressOf(id: string): { issue: number | null; blocked: string | null; protectedPaths: readonly string[]; approvedPaths: readonly string[] };
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

    await this.claim(orderId, { type: "delivery.work_retried", payload: { orderId } });
    this.launch(orderId);
    return ok(order);
  }

  async followUp(orderId: string, instruction: string): Promise<Result<WorkOrder, OrderError>> {
    const order = this.deps.findOrder(orderId);
    if (!order) return err({ kind: "not_found", message: `no order ${orderId}` });
    const { issue } = this.deps.progressOf(orderId);
    if (order.status !== "in_review" || order.pullRequest === null || issue === null) {
      return err({ kind: "invalid_transition", message: `${orderId} has no open pull request to follow up on` });
    }
    if (this.running.has(orderId)) return err({ kind: "invalid_transition", message: `${orderId} is already being worked` });

    await this.claim(orderId, { type: "delivery.follow_up_requested", payload: { orderId, instruction } });
    this.launch(orderId, () => this.runFollowUp(order, issue, instruction));
    return ok(order);
  }

  // The director signs the exact protected files the worker touched; the next run may touch those, no others.
  async approveProtected(orderId: string): Promise<Result<WorkOrder, OrderError>> {
    const order = this.deps.findOrder(orderId);
    if (!order) return err({ kind: "not_found", message: `no order ${orderId}` });
    const { blocked, protectedPaths } = this.deps.progressOf(orderId);
    if (!["signed", "on_bench", "in_review"].includes(order.status) || blocked === null || protectedPaths.length === 0) {
      return err({ kind: "invalid_transition", message: `${orderId} is not waiting for protected paths to be approved` });
    }
    if (this.running.has(orderId)) return err({ kind: "invalid_transition", message: `${orderId} is already being worked` });

    const approval = { type: "delivery.protected_paths_approved", payload: { orderId, paths: [...protectedPaths] } } as const;
    if (order.status === "in_review") {
      await this.deps.log.record([approval]);
      return ok(order);
    }
    await this.claim(orderId, approval);
    this.launch(orderId);
    return ok(order);
  }

  // Once a worker has started, only a blocked order that nobody is working on can be dropped.
  discard(orderId: string): Promise<Result<WorkOrder, OrderError>> {
    const order = this.deps.findOrder(orderId);
    if (order?.status !== "on_bench") return this.deps.orders.discard(orderId);
    if (this.running.has(orderId) || this.deps.progressOf(orderId).blocked === null) {
      return Promise.resolve(err({ kind: "invalid_transition", message: `${orderId} is being worked on: wait until it finishes or blocks` }));
    }
    return this.deps.orders.abandon(orderId);
  }

  private async claim(orderId: string, event: Parameters<EventLog["record"]>[0][number]): Promise<void> {
    this.running.add(orderId);
    try {
      await this.deps.log.record([event]);
    } catch (error) {
      this.running.delete(orderId);
      throw error;
    }
  }

  private react(event: StoredEvent): void {
    if (event.type !== "orders.signed") return;

    this.launch((event.payload as { orderId: string }).orderId);
  }

  private launch(orderId: string, task: () => Promise<void> = () => this.run(orderId)): void {
    this.running.add(orderId);
    const run = task().finally(() => {
      this.inFlight.delete(run);
      this.running.delete(orderId);
    });
    this.inFlight.add(run);
  }

  private async runFollowUp(order: WorkOrder, issue: number, instruction: string): Promise<void> {
    const { implementer, repo, log } = this.deps;
    try {
      await implementer.followUp(toWorkItem(order), repo, issue, order.pullRequest!, instruction, this.deps.progressOf(order.id).approvedPaths);
    } catch (error) {
      await log.record([{ type: "delivery.work_blocked", payload: { orderId: order.id, reason: (error as Error).message } }]);
    }
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

      const pullRequest = await implementer.implement(item, repo, issue, progressOf(orderId).approvedPaths);
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
