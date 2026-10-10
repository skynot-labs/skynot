import { err, ok, type Result } from "../../kernel";
import type { EventLog } from "../../kernel/events";
import {
  WorkOrderSpecSchema,
  abandon,
  deliver,
  describeIssues,
  discard,
  openPullRequest,
  propose,
  recordMinutes,
  sign,
  startWork,
  type MinutesBucket,
  type OrderError,
  type OrderEvent,
  type WorkOrder,
} from "../domain";
import type { OrdersProjection } from "./orders-projection";

type OrderResult = Result<WorkOrder, OrderError>;

export class OrderService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly log: EventLog,
    private readonly orders: OrdersProjection,
  ) {}

  propose(rawSpec: unknown): Promise<OrderResult> {
    return this.exclusive(async () => {
      const parsed = WorkOrderSpecSchema.safeParse(rawSpec);
      if (!parsed.success) return err({ kind: "invalid_spec", message: describeIssues(parsed.error) });

      const id = this.orders.nextId();
      await this.log.record([propose(id, parsed.data)]);
      return ok(this.orders.get(id)!);
    });
  }

  sign(id: string): Promise<OrderResult> {
    return this.act(id, sign);
  }

  discard(id: string): Promise<OrderResult> {
    return this.act(id, discard);
  }

  abandon(id: string): Promise<OrderResult> {
    return this.act(id, abandon);
  }

  startWork(id: string): Promise<OrderResult> {
    return this.act(id, startWork);
  }

  openPullRequest(id: string, pullRequest: number): Promise<OrderResult> {
    return this.act(id, (order) => openPullRequest(order, pullRequest));
  }

  deliver(id: string): Promise<OrderResult> {
    return this.act(id, deliver);
  }

  recordMinutes(id: string, bucket: MinutesBucket): Promise<OrderResult> {
    return this.act(id, (order) => recordMinutes(order, bucket));
  }

  private act(id: string, decide: (order: WorkOrder) => Result<OrderEvent, OrderError>): Promise<OrderResult> {
    return this.exclusive(async () => {
      const order = this.orders.get(id);
      if (!order) return err({ kind: "not_found", message: `no work order ${id}` });

      const decision = decide(order);
      if (!decision.ok) return decision;

      await this.log.record([decision.value]);
      return ok(this.orders.get(id)!);
    });
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
