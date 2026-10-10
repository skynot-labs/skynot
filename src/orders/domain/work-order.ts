import { err, ok, type Result } from "../../kernel";
import type { DomainEvent } from "../../kernel/events";
import type { WorkOrderSpec } from "./work-order-spec";

export type OrderId = string & { readonly __brand: "OrderId" };

export const formatOrderId = (number: number): OrderId => `WO-${String(number).padStart(4, "0")}` as OrderId;

export const orderNumber = (id: OrderId): number => Number(id.slice(3));

export type OrderStatus = "awaiting_signature" | "signed" | "on_bench" | "in_review" | "delivered" | "discarded";

export type MinutesBucket = "lt5" | "5-15" | "15-30" | "gt30";

export interface WorkOrder {
  readonly id: OrderId;
  readonly projectId: string;
  readonly ticket: number | null;
  readonly status: OrderStatus;
  readonly spec: WorkOrderSpec;
  readonly pullRequest: number | null;
  readonly minutes: MinutesBucket | null;
  readonly proposedAt: string;
  readonly signedAt: string | null;
  readonly deliveredAt: string | null;
}

export type OrderEvent =
  | { type: "orders.proposed"; payload: { orderId: OrderId; spec: WorkOrderSpec; projectId?: string; ticket?: number } }
  | { type: "orders.signed"; payload: { orderId: OrderId } }
  | { type: "orders.discarded"; payload: { orderId: OrderId } }
  | { type: "orders.work_started"; payload: { orderId: OrderId } }
  | { type: "orders.pull_request_opened"; payload: { orderId: OrderId; pullRequest: number } }
  | { type: "orders.delivered"; payload: { orderId: OrderId } }
  | { type: "orders.minutes_recorded"; payload: { orderId: OrderId; bucket: MinutesBucket } };

export interface OrderError {
  readonly kind: "not_found" | "invalid_transition" | "invalid_spec";
  readonly message: string;
}

export function asOrderEvent(event: DomainEvent): OrderEvent | null {
  return event.type.startsWith("orders.") ? (event as OrderEvent) : null;
}

// The first project owns the orders written before projects existed.
export function evolve(order: WorkOrder | null, event: OrderEvent, at: string, firstProject = "default"): WorkOrder | null {
  if (event.type === "orders.proposed") {
    return {
      id: event.payload.orderId,
      projectId: event.payload.projectId ?? firstProject,
      ticket: event.payload.ticket ?? null,
      status: "awaiting_signature",
      spec: event.payload.spec,
      pullRequest: null,
      minutes: null,
      proposedAt: at,
      signedAt: null,
      deliveredAt: null,
    };
  }
  if (!order) return null;

  switch (event.type) {
    case "orders.signed":
      return { ...order, status: "signed", signedAt: at };
    case "orders.discarded":
      return { ...order, status: "discarded" };
    case "orders.work_started":
      return { ...order, status: "on_bench" };
    case "orders.pull_request_opened":
      return { ...order, status: "in_review", pullRequest: event.payload.pullRequest };
    case "orders.delivered":
      return { ...order, status: "delivered", deliveredAt: at };
    case "orders.minutes_recorded":
      return { ...order, minutes: event.payload.bucket };
  }
}

export function propose(id: OrderId, spec: WorkOrderSpec, scope: { projectId?: string; ticket?: number } = {}): OrderEvent {
  return { type: "orders.proposed", payload: { orderId: id, spec, ...scope } };
}

export const sign = (order: WorkOrder) =>
  transition(order, "sign", ["awaiting_signature"], { type: "orders.signed", payload: { orderId: order.id } });

export const discard = (order: WorkOrder) =>
  transition(order, "discard", ["awaiting_signature", "signed"], {
    type: "orders.discarded",
    payload: { orderId: order.id },
  });

export const abandon = (order: WorkOrder) =>
  transition(order, "abandon", ["on_bench"], { type: "orders.discarded", payload: { orderId: order.id } });

export const startWork = (order: WorkOrder) =>
  transition(order, "start work on", ["signed"], { type: "orders.work_started", payload: { orderId: order.id } });

export const openPullRequest = (order: WorkOrder, pullRequest: number) =>
  transition(order, "open a pull request for", ["on_bench"], {
    type: "orders.pull_request_opened",
    payload: { orderId: order.id, pullRequest },
  });

export const deliver = (order: WorkOrder) =>
  transition(order, "deliver", ["in_review"], { type: "orders.delivered", payload: { orderId: order.id } });

export function recordMinutes(order: WorkOrder, bucket: MinutesBucket): Result<OrderEvent, OrderError> {
  if (order.minutes !== null) return invalid(`${order.id} already has its minutes recorded`);
  return transition(order, "record minutes for", ["delivered"], {
    type: "orders.minutes_recorded",
    payload: { orderId: order.id, bucket },
  });
}

function transition(
  order: WorkOrder,
  action: string,
  allowedFrom: readonly OrderStatus[],
  event: OrderEvent,
): Result<OrderEvent, OrderError> {
  if (!allowedFrom.includes(order.status)) return invalid(`cannot ${action} ${order.id}: it is ${order.status}`);
  return ok(event);
}

const invalid = (message: string) => err<OrderError>({ kind: "invalid_transition", message });
