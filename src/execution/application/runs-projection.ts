import type { Projection, StoredEvent } from "../../kernel/events";
import { asRunEvent, evolve, type Run, type RunId } from "../domain";

export class RunsProjection implements Projection {
  private readonly runs = new Map<RunId, Run>();

  apply(stored: StoredEvent): void {
    const event = asRunEvent(stored);
    if (!event) return;

    const next = evolve(this.runs.get(event.payload.runId) ?? null, event, stored.occurredAt);
    if (next) this.runs.set(next.id, next);
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

  queuePosition(id: RunId): number | null {
    const index = this.list()
      .filter((run) => run.status === "queued")
      .findIndex((run) => run.id === id);
    return index === -1 ? null : index + 1;
  }
}
