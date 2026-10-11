import { err, ok, type Result } from "../../kernel";
import type { EventRecorder } from "../../kernel/events";
import {
  MAX_PLAN,
  WorkOrderSpecSchema,
  abandon,
  deliver,
  describeIssues,
  discard,
  formatOrderId,
  openPullRequest,
  orderNumber,
  propose,
  recordMinutes,
  sign,
  startWork,
  type MinutesBucket,
  type OrderError,
  type OrderEvent,
  type WorkOrder,
  type WorkOrderSpec,
} from "../domain";
import type { OrdersProjection } from "./orders-projection";

type OrderResult = Result<WorkOrder, OrderError>;
type PlanResult = Result<WorkOrder[], OrderError>;

const invalidSpec = (message: string) => err<OrderError>({ kind: "invalid_spec", message });

export class OrderService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly log: EventRecorder,
    private readonly orders: OrdersProjection,
  ) {}

  async propose(rawSpec: unknown, scope: { projectId?: string; ticket?: number } = {}): Promise<OrderResult> {
    const plan = await this.proposePlan([rawSpec], scope);
    return plan.ok ? ok(plan.value[0]!) : plan;
  }

  // Orders proposed together are one plan: signed together, and replaced together while none of them is signed.
  proposePlan(rawSpecs: readonly unknown[], scope: { projectId?: string; ticket?: number; replaces?: string } = {}): Promise<PlanResult> {
    return this.exclusive(async () => {
      if (rawSpecs.length === 0 || rawSpecs.length > MAX_PLAN) return invalidSpec(`a plan holds 1 to ${MAX_PLAN} orders`);
      const specs: WorkOrderSpec[] = [];
      for (const [index, raw] of rawSpecs.entries()) {
        const parsed = WorkOrderSpecSchema.safeParse(raw);
        if (!parsed.success) return invalidSpec(rawSpecs.length > 1 ? `order ${index + 1}: ${describeIssues(parsed.error)}` : describeIssues(parsed.error));
        const later = (parsed.data.needs ?? []).filter((position) => position > index);
        if (later.length > 0) return invalidSpec(`order ${index + 1}: needs can only name earlier orders of the plan, not ${later.join(", ")}`);
        specs.push(parsed.data);
      }

      const replaced = scope.replaces === undefined ? [] : this.orders.planOf(scope.replaces).filter((order) => scope.projectId === undefined || order.projectId === scope.projectId);
      if (scope.replaces !== undefined && replaced.length === 0) return invalidSpec(`replaces: no plan ${scope.replaces} in this project`);
      const started = replaced.filter((order) => order.status !== "awaiting_signature" && order.status !== "discarded");
      if (started.length > 0) return err({ kind: "invalid_transition", message: `the plan ${scope.replaces} is already signed (${started.map((order) => order.id).join(", ")}): propose the change as a new plan` });

      const gone = new Set<string>(replaced.map((order) => order.id));
      const unknown = specs.flatMap((spec) => spec.dependsOn ?? []).filter((dependency) => {
        const found = this.orders.get(dependency);
        return !found || gone.has(dependency) || (scope.projectId !== undefined && found.projectId !== scope.projectId);
      });
      if (unknown.length > 0) return invalidSpec(`dependsOn: no such order in this project: ${[...new Set(unknown)].join(", ")}`);

      const first = orderNumber(this.orders.nextId());
      const ids = specs.map((_, index) => formatOrderId(first + index));
      const { replaces: _replaces, ...where } = scope;
      await this.log.record([
        ...replaced.filter((order) => order.status === "awaiting_signature").map((order): OrderEvent => ({ type: "orders.discarded", payload: { orderId: order.id } })),
        ...specs.map(({ needs, ...spec }, index) => {
          const dependsOn = [...new Set([...(spec.dependsOn ?? []), ...(needs ?? []).map((position) => ids[position - 1]!)])];
          return propose(ids[index]!, { ...spec, ...(dependsOn.length > 0 && { dependsOn }) }, { ...where, plan: ids[0]! });
        }),
      ]);
      return ok(ids.map((id) => this.orders.get(id)!));
    });
  }

  // One signature for the whole plan; the orders start in the sequence their dependencies allow.
  signPlan(planId: string): Promise<PlanResult> {
    return this.exclusive(async () => {
      const plan = this.orders.planOf(planId);
      if (plan.length === 0) return err({ kind: "not_found", message: `no plan ${planId}` });
      const waiting = plan.filter((order) => order.status === "awaiting_signature");
      if (waiting.length === 0) return err({ kind: "invalid_transition", message: `the plan ${planId} has nothing left to sign` });

      await this.log.record(waiting.map((order): OrderEvent => ({ type: "orders.signed", payload: { orderId: order.id } })));
      return ok(waiting.map((order) => this.orders.get(order.id)!));
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
