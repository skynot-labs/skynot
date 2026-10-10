import type { ShopControl, RunsProjection } from "../execution";
import type { EventLog, StoredEvent } from "../kernel/events";

export interface CostGuardDependencies {
  log: EventLog;
  runs: RunsProjection;
  control: ShopControl;
  maxUsdPerDay: number | undefined;
  onError?: (error: unknown, event: StoredEvent) => void;
}

// Pauses the shop once a day's spending reaches the cap. Resuming the same day is the director's call.
export class CostGuard {
  constructor(private readonly deps: CostGuardDependencies) {}

  start(): () => void {
    return this.deps.log.subscribe((event) => this.react(event));
  }

  private react(event: StoredEvent): void {
    const { maxUsdPerDay, runs, control } = this.deps;
    if (maxUsdPerDay === undefined || event.type !== "execution.run_completed") return;

    const day = event.occurredAt.slice(0, 10);
    const spent = runs.spentOn(day);
    if (spent < maxUsdPerDay || control.paused() || control.capDay() === day) return;

    void control
      .pause(`the daily cost cap of $${maxUsdPerDay.toFixed(2)} was reached ($${spent.toFixed(2)} spent)`, day)
      .catch((error) => this.deps.onError?.(error, event));
  }
}
