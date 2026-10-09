import { err, ok, type Clock, type Result } from "../../kernel";
import type { EventLog, Projection, StoredEvent } from "../../kernel/events";
import type { Policy, PolicyViolation } from "../domain";

const ACTION_SPENT = "governance.action_spent";

export class ActionCounts implements Projection {
  private readonly perDay = new Map<string, number>();
  private readonly perOrder = new Map<string, number>();

  apply(event: StoredEvent): void {
    if (event.type !== ACTION_SPENT) return;

    const day = dayOf(event.occurredAt);
    const orderId = (event.payload as { orderId: string | null }).orderId;
    increment(this.perDay, day);
    if (orderId) increment(this.perOrder, `${day}:${orderId}`);
  }

  forDay(day: string): number {
    return this.perDay.get(day) ?? 0;
  }

  forOrder(day: string, orderId: string): number {
    return this.perOrder.get(`${day}:${orderId}`) ?? 0;
  }
}

export class ActionBudget {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly policy: Policy,
    private readonly log: EventLog,
    private readonly counts: ActionCounts,
    private readonly clock: Clock,
  ) {}

  spend(orderId: string | null): Promise<Result<void, PolicyViolation>> {
    const result = this.queue.then(() => this.trySpend(orderId));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async trySpend(orderId: string | null): Promise<Result<void, PolicyViolation>> {
    const day = dayOf(this.clock.now().toISOString());
    const { actions_per_day, actions_per_order_per_day } = this.policy.limits;

    if (this.counts.forDay(day) >= actions_per_day) {
      return err({ kind: "action_limit_reached", message: `the daily limit of ${actions_per_day} actions is reached` });
    }
    if (orderId && this.counts.forOrder(day, orderId) >= actions_per_order_per_day) {
      return err({ kind: "action_limit_reached", message: `${orderId} reached its limit of ${actions_per_order_per_day} actions today` });
    }

    await this.log.record([{ type: ACTION_SPENT, payload: { orderId } }]);
    return ok(undefined);
  }
}

const dayOf = (isoTimestamp: string): string => isoTimestamp.slice(0, 10);

function increment(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}
