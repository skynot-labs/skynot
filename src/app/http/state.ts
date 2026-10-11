import { outcomeOf } from "../../execution";
import { renderCard } from "../../orders";
import { describeRoles } from "../../team";
import { answeredOf, inboxOf } from "../inbox";
import type { Shop } from "../shop";

const ACTIVITY_LIMIT = 100;
const RUNS_LIMIT = 50;
const LIVE: readonly string[] = ["signed", "on_bench", "in_review"];

export function readState(shop: Shop, projectId?: string) {
  const desk = (projectId ? shop.desk(projectId) : undefined) ?? shop.desks[0]!;
  const { project } = desk;
  const reviewing = desk.reviewer !== undefined;
  return {
    project: { id: project.id, repo: project.repo, name: project.name, description: project.description },
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
      working: shop.flow.working(order.id),
      ...shop.activity.linksFor(order.id),
      blocked: blockedReason(shop, order),
      ready: isReady(shop.activity.linksFor(order.id), reviewing),
    })),
    chat: desk.chat.messages(),
    decisions: desk.chat.openDecisions(),
    inbox: inboxOf(shop, project.id),
    answered: answeredOf(shop, project.id),
    team: describeRoles({ roles: desk.team.roles, ...(desk.team.workers && { workers: desk.team.workers }), advisors: desk.roster.members() }),
    teamChanges: desk.roster.pending(),
    briefingChanges: shop.briefingChanges.pendingFor(project.id),
    briefing: shop.briefingChanges.signedFor(project.id),
    hireable: desk.roster.hireable(),
    paused: shop.control.paused(),
    projectPaused: shop.control.projectPaused(project.id),
    costs: {
      today: shop.runs.spentOn(new Date().toISOString().slice(0, 10)),
      total: shop.runs.spentTotal(),
      cap: shop.maxUsdPerDay ?? null,
      project: shop.runs.spentByProject(project.id),
      tokens: shop.runs.usageByProject(project.id),
    },
    runs: shop.runs.finished(project.id, RUNS_LIMIT).map((run) => ({
      runId: run.id,
      role: run.role,
      engine: run.engine,
      model: run.model,
      turns: run.turns,
      orderId: run.orderId,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      outcome: outcomeOf(run),
      failure: run.failure ? { kind: run.failure.kind, message: run.failure.message } : null,
      costUsd: run.costUsd,
      usage: run.usage,
    })),
    agents: shop.runs.byRole(project.id),
    preferences: shop.preferences.all(),
    presence: presence(shop, project.id),
    activity: shop.activity.recent(ACTIVITY_LIMIT, project.id),
  };
}

// What the selector shows for a project: how much waits on the director.
function summary(shop: Shop, desk: Shop["desks"][number]) {
  const orders = shop.orders.listFor(desk.project.id);
  const blocked = orders.filter((order) => blockedReason(shop, order) !== null).length;
  const awaiting = orders.filter((order) => order.status === "awaiting_signature").length;
  const questions = inboxOf(shop, desk.project.id).length;
  const { id, repo, name, description } = desk.project;
  const changes = desk.roster.pending().length + shop.briefingChanges.pendingFor(id).length;
  return { id, repo, name, description, paused: shop.control.projectPaused(id) !== null, awaitingSignature: awaiting, changes, blocked, questions, needsYou: awaiting + changes + blocked + questions };
}

// A block stops mattering once the order is delivered or discarded, though its last reason stays in the log.
function blockedReason(shop: Shop, order: { id: string; status: string }): string | null {
  return LIVE.includes(order.status) ? shop.activity.linksFor(order.id).blocked : null;
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
