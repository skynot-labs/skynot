import type { Projection, StoredEvent } from "../kernel/events";

export interface ActivityEntry {
  readonly sequence: number;
  readonly at: string;
  readonly orderId: string | null;
  readonly kind: "order" | "delivery" | "run" | "advice";
  readonly text: string;
  readonly url: string | null;
}

export interface OrderLinks {
  readonly issue: number | null;
  readonly issueUrl: string | null;
  readonly pullRequestUrl: string | null;
  readonly blocked: string | null;
}

const NO_LINKS: OrderLinks = { issue: null, issueUrl: null, pullRequestUrl: null, blocked: null };

type Payload = Record<string, unknown>;

export class ActivityProjection implements Projection {
  private readonly entries: ActivityEntry[] = [];
  private readonly links = new Map<string, OrderLinks>();
  private readonly runOrders = new Map<string, { role: string; orderId: string | null }>();

  apply(event: StoredEvent): void {
    const payload = event.payload as Payload;
    const entry = this.describe(event, payload);
    if (entry) this.entries.push({ sequence: event.sequence, at: event.occurredAt, ...entry });
    this.trackLinks(event.type, payload);
  }

  recent(count: number): readonly ActivityEntry[] {
    return this.entries.slice(-count).reverse();
  }

  linksFor(orderId: string): OrderLinks {
    return this.links.get(orderId) ?? NO_LINKS;
  }

  private describe(event: StoredEvent, payload: Payload): Omit<ActivityEntry, "sequence" | "at"> | null {
    const orderId = typeof payload.orderId === "string" ? payload.orderId : null;
    const order = (text: string, url: string | null = null) => ({ orderId, kind: "order" as const, text, url });
    const delivery = (text: string, url: string | null = null) => ({ orderId, kind: "delivery" as const, text, url });
    const advice = (text: string) => ({ orderId: null, kind: "advice" as const, text, url: null });

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
      case "delivery.work_retried":
        return delivery("retry requested");
      case "delivery.follow_up_requested":
        return delivery(`follow-up requested: ${payload.instruction}`);
      case "delivery.pull_request_updated":
        return delivery(`pull request #${payload.number} updated`);
      case "team.change_proposed":
        return advice(`the Manager proposes to ${payload.action} ${payload.role}: ${payload.reason}`);
      case "team.change_signed":
        return advice(payload.action === "hire" ? `${payload.role} joined the team` : `${payload.role} left the team`);
      case "team.change_discarded":
        return advice(`the proposal to ${payload.action} ${payload.role} was discarded`);
      case "manager.answer_rejected":
        return { orderId: null, kind: "run" as const, text: `the Manager's answer was rejected (try ${payload.attempt}): ${String(payload.issues).replaceAll("\n", "; ").slice(0, 300)}`, url: null };
      case "manager.consulted":
        return advice(`the Manager asked ${payload.role}: ${payload.question}`);
      case "manager.advised":
        return advice(`${payload.role} advised: ${payload.answer}`);
      case "manager.advisor_failed":
        return advice(`${payload.role} could not advise: ${payload.reason}`);
      case "execution.run_requested":
        this.runOrders.set(payload.runId as string, { role: payload.role as string, orderId });
        return null;
      case "execution.run_completed":
        return this.runEntry(payload, `finished, $${(payload.costUsd as number).toFixed(2)}`);
      case "execution.run_failed":
        return this.runEntry(payload, `failed: ${(payload.failure as { message: string }).message}`);
      default:
        return null;
    }
  }

  private runEntry(payload: Payload, text: string): Omit<ActivityEntry, "sequence" | "at"> | null {
    const run = this.runOrders.get(payload.runId as string);
    return run ? { orderId: run.orderId, kind: "run", text: `${run.role} run ${text}`, url: null } : null;
  }

  private trackLinks(type: string, payload: Payload): void {
    const orderId = payload.orderId;
    if (typeof orderId !== "string") return;
    const current = this.links.get(orderId) ?? NO_LINKS;

    switch (type) {
      case "delivery.issue_opened":
        this.links.set(orderId, { ...current, issue: payload.issue as number, issueUrl: payload.url as string });
        break;
      case "delivery.pull_request_opened":
        this.links.set(orderId, { ...current, pullRequestUrl: payload.url as string, blocked: null });
        break;
      case "delivery.work_blocked":
        this.links.set(orderId, { ...current, blocked: payload.reason as string });
        break;
      case "orders.work_started":
      case "delivery.work_retried":
      case "delivery.follow_up_requested":
      case "delivery.pull_request_updated":
        this.links.set(orderId, { ...current, blocked: null });
        break;
    }
  }
}
