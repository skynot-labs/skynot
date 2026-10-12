import { err, ok } from "../kernel";
import type { OrderDesk } from "../manager";
import { OrderService, OrdersProjection, WorkOrderSpecSchema, renderCard } from "../orders";

export function createOrderDesk(service: OrderService, orders: OrdersProjection, projectId?: string): OrderDesk {
  return {
    specSchema: WorkOrderSpecSchema,
    async propose(specs, link) {
      const result = await service.proposePlan(specs, { ...(projectId && { projectId }), ...(link?.ticket && { ticket: link.ticket }), ...(link?.replaces && { replaces: link.replaces }) });
      return result.ok ? ok({ id: result.value[0]!.id, card: result.value.map(renderCard).join("\n\n") }) : err(result.error.message);
    },
    overview: () => (projectId ? orders.listFor(projectId) : orders.list()).map((order) => ({ id: order.id, title: order.spec.title, status: order.status, plan: order.plan })),
  };
}
