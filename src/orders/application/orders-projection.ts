import type { Projection, StoredEvent } from "../../kernel/events";
import { asOrderEvent, evolve, formatOrderId, orderNumber, type OrderId, type WorkOrder } from "../domain";

export class OrdersProjection implements Projection {
  private readonly orders = new Map<OrderId, WorkOrder>();

  apply(stored: StoredEvent): void {
    const event = asOrderEvent(stored);
    if (!event) return;

    const next = evolve(this.orders.get(event.payload.orderId) ?? null, event, stored.occurredAt);
    if (next) this.orders.set(next.id, next);
  }

  get(id: string): WorkOrder | undefined {
    return this.orders.get(id as OrderId);
  }

  list(): WorkOrder[] {
    return [...this.orders.values()].sort((a, b) => orderNumber(a.id) - orderNumber(b.id));
  }

  nextId(): OrderId {
    const highest = this.list().at(-1);
    return formatOrderId(highest ? orderNumber(highest.id) + 1 : 1);
  }
}
