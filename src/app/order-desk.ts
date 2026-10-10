import { err, ok } from "../kernel";
import type { OrderDesk } from "../manager";
import { OrderService, OrdersProjection, WorkOrderSpecSchema, renderCard } from "../orders";

export function createOrderDesk(service: OrderService, orders: OrdersProjection, projectId?: string): OrderDesk {
  return {
    specSchema: WorkOrderSpecSchema,
    async propose(spec, link) {
      const result = await service.propose(spec, { ...(projectId && { projectId }), ...(link?.ticket && { ticket: link.ticket }) });
      return result.ok ? ok({ id: result.value.id, card: renderCard(result.value) }) : err(result.error.message);
    },
    overview: () => (projectId ? orders.listFor(projectId) : orders.list()).map((order) => ({ id: order.id, title: order.spec.title, status: order.status })),
  };
}
