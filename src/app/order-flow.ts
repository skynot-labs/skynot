import { followUpFromReview, type Implementer, type IssueFiler, type PullRequestReview, type WorkItem } from "../delivery";
import { err, ok, type Result } from "../kernel";
import type { EventLog, StoredEvent } from "../kernel/events";
import { blockersOf, renderCard, type OrderError, type OrderService, type OrderStatus, type WorkOrder } from "../orders";

// the reviewer's first findings go back to the worker once; after that the director decides
const AUTOMATIC_ROUNDS = 1;

const RETRYABLE: readonly OrderStatus[] = ["signed", "on_bench"];

export interface OrderFlowDependencies {
  log: EventLog;
  orders: OrderService;
  filer: IssueFiler;
  implementer: Implementer;
  reviewerFor?(order: WorkOrder): Pick<PullRequestReview, "run"> | undefined;
  repoOf(order: WorkOrder): string;
  findOrder(id: string): WorkOrder | undefined;
  listOrders(): WorkOrder[];
  workersOf(order: WorkOrder): string[];
  onError?: (error: unknown, event: StoredEvent) => void;
  progressOf(id: string): {
    issue: number | null;
    blocked: string | null;
    protectedPaths: readonly string[];
    approvedPaths: readonly string[];
    waitingOn: readonly string[];
    reviews: number;
  };
}

export class OrderFlow {
  private readonly inFlight = new Set<Promise<void>>();
  private readonly running = new Set<string>();
  private readonly stops = new Map<string, AbortController>();

  constructor(private readonly deps: OrderFlowDependencies) {}

  // A restart drops the runs in flight; an order they left half done would show no way out.
  async recover(): Promise<void> {
    for (const order of this.deps.listOrders()) {
      const unfinished = order.status === "signed" || order.status === "on_bench";
      const { blocked, waitingOn } = this.deps.progressOf(order.id);
      if (!unfinished || this.running.has(order.id) || blocked !== null) continue;
      if (order.status === "signed" && waitingOn.length > 0) {
        await this.consider(order.id);
        continue;
      }
      await this.deps.log.record([{ type: "delivery.work_blocked", payload: { orderId: order.id, reason: "the shop restarted while this order was being worked" } }]);
    }
  }

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
    this.launch(orderId, (signal) => this.runFollowUp(order, issue, instruction, signal));
    return ok(order);
  }

  // The next run, whether a retry or a follow-up, uses the new worker. A run in progress keeps its own.
  async reassign(orderId: string, worker: string): Promise<Result<WorkOrder, OrderError>> {
    const order = this.deps.findOrder(orderId);
    if (!order) return err({ kind: "not_found", message: `no order ${orderId}` });
    if (!this.deps.workersOf(order).includes(worker)) return err({ kind: "invalid_transition", message: `there is no worker ${worker}` });
    if (!["signed", "on_bench", "in_review"].includes(order.status)) return err({ kind: "invalid_transition", message: `${orderId} is ${order.status}` });
    if (this.running.has(orderId)) return err({ kind: "invalid_transition", message: `${orderId} is being worked: stop it first` });

    await this.deps.log.record([{ type: "delivery.worker_assigned", payload: { orderId, worker } }]);
    return ok(order);
  }

  requestReview(orderId: string): Result<WorkOrder, OrderError> {
    const order = this.deps.findOrder(orderId);
    if (!order) return err({ kind: "not_found", message: `no order ${orderId}` });
    if (!this.deps.reviewerFor?.(order)) return err({ kind: "invalid_transition", message: "the team has no code reviewer" });
    if (order.status !== "in_review" || order.pullRequest === null) return err({ kind: "invalid_transition", message: `${orderId} has no open pull request to review` });
    if (this.running.has(orderId)) return err({ kind: "invalid_transition", message: `${orderId} is already being worked` });

    this.launch(orderId, (signal) => this.review(orderId, signal, false));
    return ok(order);
  }

  // The order ends up blocked with "stopped by the director", so it can be retried or discarded.
  stop(orderId: string): Result<WorkOrder, OrderError> {
    const order = this.deps.findOrder(orderId);
    if (!order) return err({ kind: "not_found", message: `no order ${orderId}` });
    const stop = this.stops.get(orderId);
    if (!stop) return err({ kind: "invalid_transition", message: `${orderId} is not being worked on` });

    stop.abort();
    return ok(order);
  }

  // The chain exists to avoid conflicts; if the director takes the risk, the follow-up on conflicts covers it.
  async startNow(orderId: string): Promise<Result<WorkOrder, OrderError>> {
    const order = this.deps.findOrder(orderId);
    if (!order) return err({ kind: "not_found", message: `no order ${orderId}` });
    if (order.status !== "signed" || this.deps.progressOf(orderId).waitingOn.length === 0) {
      return err({ kind: "invalid_transition", message: `${orderId} is not waiting for another order` });
    }
    if (this.running.has(orderId)) return err({ kind: "invalid_transition", message: `${orderId} is already being worked` });

    await this.claim(orderId, { type: "delivery.wait_skipped", payload: { orderId } });
    this.launch(orderId);
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
    const track = (task: Promise<void>) => {
      const tracked = task.catch((error) => this.deps.onError?.(error, event)).finally(() => this.inFlight.delete(tracked));
      this.inFlight.add(tracked);
    };
    if (event.type === "orders.signed") track(this.consider((event.payload as { orderId: string }).orderId));
    if (event.type === "orders.delivered" || event.type === "orders.discarded") track(this.releaseWaiting());
  }

  // An order starts once nothing it depends on, or shares files with, is still unmerged.
  private async consider(orderId: string): Promise<void> {
    const order = this.deps.findOrder(orderId);
    if (order?.status !== "signed" || this.running.has(orderId)) return;

    const blockers = blockersOf(order, this.deps.listOrders());
    if (blockers.length === 0) return this.launch(orderId);

    const { waitingOn } = this.deps.progressOf(orderId);
    if (blockers.join() === waitingOn.join()) return;
    await this.deps.log.record([{ type: "delivery.work_waiting", payload: { orderId, on: blockers } }]);
  }

  private async releaseWaiting(): Promise<void> {
    for (const order of this.deps.listOrders()) {
      if (order.status === "signed" && this.deps.progressOf(order.id).waitingOn.length > 0) await this.consider(order.id);
    }
  }

  private launch(orderId: string, task: (signal: AbortSignal) => Promise<void> = (signal) => this.run(orderId, signal)): void {
    const stop = new AbortController();
    this.running.add(orderId);
    this.stops.set(orderId, stop);
    const run = task(stop.signal).finally(() => {
      this.inFlight.delete(run);
      this.running.delete(orderId);
      this.stops.delete(orderId);
    });
    this.inFlight.add(run);
  }

  private async review(orderId: string, signal: AbortSignal, mayRequestChanges = true): Promise<void> {
    const { findOrder, progressOf, repoOf, log } = this.deps;
    const order = findOrder(orderId);
    const reviewer = order && this.deps.reviewerFor?.(order);
    if (!reviewer || order?.status !== "in_review" || order.pullRequest === null || signal.aborted) return;

    const { reviews, issue } = progressOf(orderId);
    const outcome = await reviewer.run(toWorkItem(order), repoOf(order), order.pullRequest, reviews + 1, signal);
    if (!outcome.ok || !mayRequestChanges || outcome.value.verdict === "approved" || reviews >= AUTOMATIC_ROUNDS || signal.aborted || issue === null) return;

    const instruction = followUpFromReview(outcome.value);
    await log.record([{ type: "delivery.follow_up_requested", payload: { orderId, instruction } }]);
    await this.runFollowUp(order, issue, instruction, signal);
  }

  private async runFollowUp(order: WorkOrder, issue: number, instruction: string, signal: AbortSignal): Promise<void> {
    const { implementer, repoOf, log } = this.deps;
    try {
      const updated = await implementer.followUp(toWorkItem(order), repoOf(order), issue, order.pullRequest!, instruction, this.deps.progressOf(order.id).approvedPaths, signal);
      if (updated.ok) await this.review(order.id, signal);
    } catch (error) {
      await log.record([{ type: "delivery.work_blocked", payload: { orderId: order.id, reason: (error as Error).message } }]);
    }
  }

  private async run(orderId: string, signal: AbortSignal): Promise<void> {
    const { orders, filer, implementer, repoOf, findOrder, progressOf, log } = this.deps;
    try {
      const order = findOrder(orderId);
      if (!order) return;
      const item = toWorkItem(order);

      let issue = progressOf(orderId).issue;
      if (issue === null) {
        const filed = await filer.file(item, repoOf(order));
        if (!filed.ok) return;
        issue = filed.value.number;
      }

      if (order.status === "signed") {
        const started = await orders.startWork(orderId);
        if (!started.ok) return;
      }

      if (signal.aborted) {
        await log.record([{ type: "delivery.work_blocked", payload: { orderId, reason: "stopped by the director" } }]);
        return;
      }

      const pullRequest = await implementer.implement(item, repoOf(order), issue, progressOf(orderId).approvedPaths, signal);
      if (!pullRequest.ok) return;

      await orders.openPullRequest(orderId, pullRequest.value.number);
      await this.review(orderId, signal);
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
