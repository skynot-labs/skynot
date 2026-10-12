import type { Projection, StoredEvent } from "../../kernel/events";
import { asRunEvent, evolve, outcomeOf, sumUsage, type Run, type RunId, type RunOutcome, type TokenUsage } from "../domain";

export interface RoleUsage {
  readonly role: string;
  readonly runs: number;
  readonly spentUsd: number | null;
  readonly usage: TokenUsage | null;
  readonly lastOutcome: RunOutcome | null;
}

export class RunsProjection implements Projection {
  private readonly runs = new Map<RunId, Run>();
  private readonly finishOrder: RunId[] = [];

  constructor(private readonly firstProject = "default") {}

  apply(stored: StoredEvent): void {
    const event = asRunEvent(stored);
    if (!event) return;

    const previous = this.runs.get(event.payload.runId) ?? null;
    const next = evolve(previous, event, stored.occurredAt, this.firstProject);
    if (!next) return;
    this.runs.set(next.id, next);
    if (next.finishedAt !== null && previous?.finishedAt === null) this.finishOrder.push(next.id);
  }

  get(id: RunId): Run | undefined {
    return this.runs.get(id);
  }

  list(): Run[] {
    return [...this.runs.values()];
  }

  running(): Run[] {
    return this.list().filter((run) => run.status === "running");
  }

  finished(projectId: string, limit: number): Run[] {
    return this.newestFinished(projectId).slice(0, Math.max(0, limit));
  }

  usageByProject(projectId: string): TokenUsage | null {
    return usageOf(this.ofProject(projectId));
  }

  byRole(projectId: string): RoleUsage[] {
    const newestFirst = this.newestFinished(projectId);
    const byRole = new Map<string, Run[]>();
    for (const run of this.ofProject(projectId)) byRole.set(run.role, [...(byRole.get(run.role) ?? []), run]);
    return [...byRole].map(([role, runs]) => {
      const last = newestFirst.find((run) => run.role === role);
      return { role, runs: runs.length, spentUsd: reportedSum(runs), usage: usageOf(runs), lastOutcome: last ? outcomeOf(last) : null };
    });
  }

  // A day is the UTC day, like the daily action budget.
  spentOn(day: string): number {
    return sum(this.list().filter((run) => run.finishedAt?.startsWith(day)));
  }

  // The `count` days that end on `until`, oldest first; a day nobody worked is there with zero.
  spentPerDay(until: string, count: number): Array<{ day: string; usd: number }> {
    const last = Date.parse(`${until}T00:00:00.000Z`);
    return Array.from({ length: count }, (_, index) => {
      const day = new Date(last - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10);
      return { day, usd: this.spentOn(day) };
    });
  }

  spentByProject(projectId: string): number {
    return sum(this.list().filter((run) => run.projectId === projectId));
  }

  spentOnOrder(orderId: string): number {
    return sum(this.list().filter((run) => run.orderId === orderId));
  }

  spentTotal(): number {
    return sum(this.list());
  }

  queuePosition(id: RunId): number | null {
    const index = this.list()
      .filter((run) => run.status === "queued")
      .findIndex((run) => run.id === id);
    return index === -1 ? null : index + 1;
  }

  private ofProject(projectId: string): Run[] {
    return this.list().filter((run) => run.projectId === projectId);
  }

  private newestFinished(projectId: string): Run[] {
    return this.finishOrder
      .map((id) => this.runs.get(id)!)
      .filter((run) => run.projectId === projectId)
      .reverse();
  }
}

const usageOf = (runs: Run[]): TokenUsage | null => sumUsage(runs.flatMap((run) => (run.usage ? [run.usage] : [])));

const reportedCosts = (runs: Run[]): number[] => runs.flatMap((run) => (run.costUsd === null ? [] : [run.costUsd]));

const reportedSum = (runs: Run[]): number | null => (reportedCosts(runs).length === 0 ? null : sum(runs));

// Only what engines reported: a run without a cost adds nothing, so this is a floor, not the real spend.
const sum = (runs: Run[]): number => reportedCosts(runs).reduce((total, cost) => total + cost, 0);
