import { renderCard } from "../../orders";
import { describeRoles } from "../../team";
import { inboxOf } from "../inbox";
import type { Shop } from "../shop";

const ACTIVITY_LIMIT = 100;

export function readState(shop: Shop, projectId?: string) {
  const desk = (projectId ? shop.desk(projectId) : undefined) ?? shop.desks[0]!;
  const { project } = desk;
  const reviewing = desk.reviewer !== undefined;
  return {
    project: { id: project.id, repo: project.repo },
    projects: shop.desks.map((entry) => summary(shop, entry)),
    repo: project.repo,
    reviewing,
    readiness: shop.readiness.findings(),
    workers: desk.workers,
    cursor: shop.cursor.value,
    orders: shop.orders.listFor(project.id).map((order) => ({
      id: order.id,
      title: order.spec.title,
      objective: order.spec.objective,
      risk: order.spec.risk,
      criteria: order.spec.acceptanceCriteria,
      outOfScope: order.spec.outOfScope,
      status: order.status,
      card: renderCard(order),
      pullRequest: order.pullRequest,
      ticket: order.ticket,
      minutes: order.minutes,
      proposedAt: order.proposedAt,
      signedAt: order.signedAt,
      deliveredAt: order.deliveredAt,
      spentUsd: shop.runs.spentOnOrder(order.id),
      ...shop.activity.linksFor(order.id),
      ready: isReady(shop.activity.linksFor(order.id), reviewing),
    })),
    chat: desk.chat.messages(),
    decisions: desk.chat.openDecisions(),
    inbox: inboxOf(shop, project.id),
    team: describeRoles({ roles: desk.team.roles, ...(desk.team.workers && { workers: desk.team.workers }), advisors: desk.roster.members() }),
    teamChanges: desk.roster.pending(),
    briefingChanges: shop.briefingChanges.pendingFor(project.id),
    briefing: shop.briefingChanges.signedFor(project.id),
    hireable: desk.roster.hireable(),
    paused: shop.control.paused(),
    costs: {
      today: shop.runs.spentOn(new Date().toISOString().slice(0, 10)),
      total: shop.runs.spentTotal(),
      cap: shop.maxUsdPerDay ?? null,
      project: shop.runs.spentByProject(project.id),
    },
    presence: presence(shop, project.id),
    activity: shop.activity.recent(ACTIVITY_LIMIT, project.id),
  };
}

// What the selector shows for a project: how much waits on the director.
function summary(shop: Shop, desk: Shop["desks"][number]) {
  const orders = shop.orders.listFor(desk.project.id);
  const blocked = orders.filter((order) => ["signed", "on_bench", "in_review"].includes(order.status) && shop.activity.linksFor(order.id).blocked !== null).length;
  const awaiting = orders.filter((order) => order.status === "awaiting_signature").length;
  const questions = inboxOf(shop, desk.project.id).length;
  return { id: desk.project.id, repo: desk.project.repo, awaitingSignature: awaiting, blocked, questions, needsYou: awaiting + blocked + questions };
}

function presence(shop: Shop, projectId: string) {
  const runs = shop.runs.list().filter((run) => run.projectId === projectId);
  return {
    working: runs
      .filter((run) => run.status === "running")
      .map((run) => ({ runId: run.id, role: run.role, engine: run.engine, orderId: run.orderId, since: run.startedAt })),
    waiting: runs
      .filter((run) => run.status === "queued")
      .map((run) => ({ runId: run.id, role: run.role, orderId: run.orderId, position: shop.runs.queuePosition(run.id) })),
  };
}

// "Reviewed" means approved by the independent reviewer, and the pull request's checks are not red or running.
function isReady(links: ReturnType<Shop["activity"]["linksFor"]>, reviewing: boolean): boolean {
  const checksOk = links.checks === "none" || links.checks === "passing";
  return links.pullRequestUrl !== null && checksOk && (!reviewing || links.review?.verdict === "approved");
}
