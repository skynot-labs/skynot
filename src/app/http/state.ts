import { renderCard } from "../../orders";
import { describeRoles } from "../../team";
import type { Shop } from "../shop";

const ACTIVITY_LIMIT = 100;

export function readState(shop: Shop) {
  return {
    repo: shop.repo,
    cursor: shop.cursor.value,
    orders: shop.orders.list().map((order) => ({
      id: order.id,
      title: order.spec.title,
      objective: order.spec.objective,
      risk: order.spec.risk,
      criteria: order.spec.acceptanceCriteria,
      outOfScope: order.spec.outOfScope,
      status: order.status,
      card: renderCard(order),
      pullRequest: order.pullRequest,
      minutes: order.minutes,
      proposedAt: order.proposedAt,
      signedAt: order.signedAt,
      deliveredAt: order.deliveredAt,
      spentUsd: shop.runs.spentOnOrder(order.id),
      ...shop.activity.linksFor(order.id),
    })),
    chat: shop.chat.messages(),
    decisions: shop.chat.openDecisions(),
    team: describeRoles({ roles: shop.team.roles, advisors: shop.roster.members() }),
    teamChanges: shop.roster.pending(),
    hireable: shop.roster.hireable(),
    paused: shop.control.paused(),
    costs: { today: shop.runs.spentOn(new Date().toISOString().slice(0, 10)), total: shop.runs.spentTotal(), cap: shop.maxUsdPerDay ?? null },
    presence: presence(shop),
    activity: shop.activity.recent(ACTIVITY_LIMIT),
  };
}

function presence(shop: Shop) {
  const runs = shop.runs.list();
  return {
    working: runs
      .filter((run) => run.status === "running")
      .map((run) => ({ runId: run.id, role: run.role, engine: run.engine, orderId: run.orderId, since: run.startedAt })),
    waiting: runs
      .filter((run) => run.status === "queued")
      .map((run) => ({ runId: run.id, role: run.role, orderId: run.orderId, position: shop.runs.queuePosition(run.id) })),
  };
}
