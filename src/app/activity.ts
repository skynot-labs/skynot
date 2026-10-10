import { reportedCost, type EngineName } from "../execution";
import type { Projection, StoredEvent } from "../kernel/events";

export interface ActivityEntry {
  readonly sequence: number;
  readonly at: string;
  readonly orderId: string | null;
  readonly projectId: string;
  readonly kind: "order" | "delivery" | "run" | "advice";
  readonly text: string;
  readonly url: string | null;
}

export interface AnsweredQuestion {
  readonly question: string;
  readonly answer: string;
  readonly from: string;
  readonly askedAt: string;
  readonly answeredAt: string;
}

export interface OrderLinks {
  readonly issue: number | null;
  readonly issueUrl: string | null;
  readonly pullRequestUrl: string | null;
  readonly blocked: string | null;
  readonly protectedPaths: readonly string[];
  readonly approvedPaths: readonly string[];
  readonly waitingOn: readonly string[];
  readonly worker: string | null;
  readonly question: string | null;
  readonly questionAt: string | null;
  readonly answers: readonly string[];
  readonly answered: readonly AnsweredQuestion[];
  readonly reviews: number;
  readonly review: { readonly verdict: "approved" | "changes_requested"; readonly summary: string; readonly findings: readonly string[] } | null;
  readonly checks: "none" | "pending" | "passing" | "failing" | null;
}

const NO_LINKS: OrderLinks = { issue: null, issueUrl: null, pullRequestUrl: null, blocked: null, protectedPaths: [], approvedPaths: [], waitingOn: [], worker: null, question: null, questionAt: null, answers: [], answered: [], reviews: 0, review: null, checks: null };
const UNBLOCKED = { blocked: null, protectedPaths: [] };

type Payload = Record<string, unknown>;

export class ActivityProjection implements Projection {
  private readonly entries: ActivityEntry[] = [];
  private readonly links = new Map<string, OrderLinks>();
  private readonly runOrders = new Map<string, { role: string; engine: EngineName; orderId: string | null }>();
  private readonly orderProjects = new Map<string, string>();
  private readonly runProjects = new Map<string, string>();

  constructor(private readonly firstProject = "default") {}

  apply(event: StoredEvent): void {
    const payload = event.payload as Payload;
    if (event.type === "orders.proposed") this.orderProjects.set(payload.orderId as string, typeof payload.projectId === "string" ? payload.projectId : this.firstProject);
    if (event.type === "execution.run_requested") this.runProjects.set(payload.runId as string, this.projectOf(payload));
    const entry = this.describe(event, payload);
    if (entry) this.entries.push({ sequence: event.sequence, at: event.occurredAt, projectId: this.projectOf(payload), ...entry });
    this.trackLinks(event.type, payload, event.occurredAt);
  }

  recent(count: number, projectId?: string): readonly ActivityEntry[] {
    const entries = projectId ? this.entries.filter((entry) => entry.projectId === projectId) : this.entries;
    return entries.slice(-count).reverse();
  }

  private projectOf(payload: Payload): string {
    if (typeof payload.runId === "string" && this.runProjects.has(payload.runId)) return this.runProjects.get(payload.runId)!;
    if (typeof payload.projectId === "string") return payload.projectId;
    if (typeof payload.orderId === "string") return this.orderProjects.get(payload.orderId) ?? this.firstProject;
    return this.firstProject;
  }

  linksFor(orderId: string): OrderLinks {
    return this.links.get(orderId) ?? NO_LINKS;
  }

  private describe(event: StoredEvent, payload: Payload): Omit<ActivityEntry, "sequence" | "at" | "projectId"> | null {
    const orderId = typeof payload.orderId === "string" ? payload.orderId : null;
    const order = (text: string, url: string | null = null) => ({ orderId, kind: "order" as const, text, url });
    const delivery = (text: string, url: string | null = null) => ({ orderId, kind: "delivery" as const, text, url });
    const advice = (text: string) => ({ orderId: null, kind: "advice" as const, text, url: null });
    const shop = (text: string) => ({ orderId: null, kind: "run" as const, text, url: null });

    switch (event.type) {
      case "orders.proposed":
        return order(`proposed: ${(payload.spec as { title: string }).title}`);
      case "orders.signed":
        return order("signed by the director");
      case "orders.discarded":
        return order("discarded");
      case "orders.work_started":
        return order("work started");
      case "orders.pull_request_opened":
        return order(`in review, pull request #${payload.pullRequest}`);
      case "orders.delivered":
        return order("delivered");
      case "orders.minutes_recorded":
        return order(`cost the director ${payload.bucket} minutes`);
      case "delivery.issue_opened":
        return delivery(`issue #${payload.issue} opened`, payload.url as string);
      case "delivery.pull_request_opened":
        return delivery(`pull request #${payload.number} opened`, payload.url as string);
      case "delivery.work_blocked":
        return delivery(`blocked: ${payload.reason}`);
      case "delivery.protected_paths_found":
        return delivery(`protected paths touched: ${(payload.paths as string[]).join(", ")}`);
      case "delivery.protected_paths_approved":
        return delivery(`the director approved: ${(payload.paths as string[]).join(", ")}`);
      case "delivery.question_raised":
        return delivery(`the worker asks: ${payload.question}`);
      case "delivery.question_answered":
        return delivery(`the director answered: ${payload.answer}`);
      case "delivery.worker_assigned":
        return delivery(`assigned to ${payload.worker}`);
      case "delivery.review_completed":
        return delivery(`review round ${payload.round}: ${payload.verdict === "approved" ? "approved" : "changes requested"}. ${payload.summary}`);
      case "delivery.review_failed":
        return delivery(`the review failed: ${payload.reason}`);
      case "delivery.checks_changed":
        return delivery(`checks: ${payload.state}`);
      case "delivery.work_waiting":
        return delivery(`waiting for ${(payload.on as string[]).join(", ")} to be merged`);
      case "delivery.wait_skipped":
        return delivery("the director chose not to wait");
      case "delivery.work_retried":
        return delivery("retry requested");
      case "delivery.follow_up_requested":
        return delivery(`follow-up requested: ${payload.instruction}`);
      case "delivery.pull_request_updated":
        return delivery(`pull request #${payload.number} updated`);
      case "control.paused":
        return shop(`the shop was paused: ${payload.reason}`);
      case "control.resumed":
        return shop("the shop resumed");
      case "control.project_paused":
        return shop(`project paused: ${payload.reason}`);
      case "control.project_resumed":
        return shop("project resumed");
      case "projects.registered":
        return shop("project registered; it starts with the next restart");
      case "projects.described":
        return shop("project name and description changed");
      case "team.change_proposed":
        return advice(`the Manager proposes to ${payload.action} ${payload.role}: ${payload.reason}`);
      case "team.change_signed":
        return advice(payload.action === "hire" ? `${payload.role} joined the team` : payload.action === "dismiss" ? `${payload.role} left the team` : `${payload.role} has a new focus: ${payload.focus}`);
      case "projects.briefing_proposed":
        return advice(`the Manager proposes a new briefing: ${payload.reason}`);
      case "projects.briefing_signed":
        return advice("the briefing was updated");
      case "projects.briefing_discarded":
        return advice("the proposal to change the briefing was discarded");
      case "team.change_discarded":
        return advice(`the proposal to ${payload.action} ${payload.role} was discarded`);
      case "manager.answer_rejected":
        return shop(`the Manager's answer was rejected (try ${payload.attempt}): ${String(payload.issues).replaceAll("\n", "; ").slice(0, 300)}`);
      case "manager.consulted":
        return advice(`the Manager asked ${payload.role}: ${payload.question}`);
      case "manager.advised":
        return advice(`${payload.role} advised: ${payload.answer}`);
      case "manager.advisor_failed":
        return advice(`${payload.role} could not advise: ${payload.reason}`);
      case "execution.run_requested":
        this.runOrders.set(payload.runId as string, { role: payload.role as string, engine: payload.engine as EngineName, orderId });
        return null;
      case "execution.run_completed": {
        const engine = this.runOrders.get(payload.runId as string)?.engine;
        const cost = engine ? reportedCost(engine, (payload.costUsd as number | null | undefined) ?? null) : null;
        return this.runEntry(payload, cost === null ? "finished" : `finished, $${cost.toFixed(2)}`);
      }
      case "execution.run_failed":
        return this.runEntry(payload, `failed: ${(payload.failure as { message: string }).message}`);
      default:
        return null;
    }
  }

  private runEntry(payload: Payload, text: string): Omit<ActivityEntry, "sequence" | "at" | "projectId"> | null {
    const run = this.runOrders.get(payload.runId as string);
    return run ? { orderId: run.orderId, kind: "run", text: `${run.role} run ${text}`, url: null } : null;
  }

  private trackLinks(type: string, payload: Payload, at: string): void {
    const orderId = payload.orderId;
    if (typeof orderId !== "string") return;
    const current = this.links.get(orderId) ?? NO_LINKS;

    switch (type) {
      case "delivery.issue_opened":
        this.links.set(orderId, { ...current, issue: payload.issue as number, issueUrl: payload.url as string });
        break;
      case "delivery.pull_request_opened":
        this.links.set(orderId, { ...current, pullRequestUrl: payload.url as string, ...UNBLOCKED });
        break;
      case "delivery.work_blocked":
        this.links.set(orderId, { ...current, blocked: payload.reason as string });
        break;
      case "delivery.protected_paths_found":
        this.links.set(orderId, { ...current, protectedPaths: payload.paths as string[] });
        break;
      case "delivery.protected_paths_approved":
        this.links.set(orderId, { ...current, ...UNBLOCKED, approvedPaths: [...new Set([...current.approvedPaths, ...(payload.paths as string[])])] });
        break;
      case "delivery.question_raised":
        this.links.set(orderId, { ...current, question: payload.question as string, questionAt: at });
        break;
      case "delivery.question_answered": {
        const question = current.question ?? "question";
        const answer = payload.answer as string;
        this.links.set(orderId, {
          ...current,
          question: null,
          questionAt: null,
          answers: [...current.answers, `${question} → ${answer}`],
          answered: [...current.answered, { question, answer, from: current.worker ?? "developer", askedAt: current.questionAt ?? at, answeredAt: at }],
        });
        break;
      }
      case "delivery.worker_assigned":
        this.links.set(orderId, { ...current, worker: payload.worker as string });
        break;
      case "delivery.review_completed":
        this.links.set(orderId, {
          ...current,
          reviews: current.reviews + 1,
          review: { verdict: payload.verdict as "approved" | "changes_requested", summary: payload.summary as string, findings: payload.findings as string[] },
        });
        break;
      case "delivery.checks_changed":
        this.links.set(orderId, { ...current, checks: payload.state as OrderLinks["checks"] });
        break;
      case "delivery.pull_request_updated":
        this.links.set(orderId, { ...current, ...UNBLOCKED, review: null, checks: null });
        break;
      case "delivery.work_waiting":
        this.links.set(orderId, { ...current, waitingOn: payload.on as string[] });
        break;
      case "delivery.wait_skipped":
      case "orders.work_started":
        this.links.set(orderId, { ...current, ...UNBLOCKED, waitingOn: [] });
        break;
      case "delivery.work_retried":
      case "delivery.follow_up_requested":
        this.links.set(orderId, { ...current, ...UNBLOCKED });
        break;
    }
  }
}
