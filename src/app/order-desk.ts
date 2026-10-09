import { err, ok } from "../kernel";
import type { OrderDesk } from "../manager";
import { OrderService, OrdersProjection, WorkOrderSpecSchema, renderCard } from "../orders";

export function createOrderDesk(service: OrderService, orders: OrdersProjection): OrderDesk {
  return {
    specSchema: WorkOrderSpecSchema,
    async propose(spec) {
      const result = await service.propose(spec);
      return result.ok ? ok({ id: result.value.id, card: renderCard(result.value) }) : err(result.error.message);
    },
    overview: () => orders.list().map((order) => ({ id: order.id, title: order.spec.title, status: order.status })),
  };
}
