import type { PendingEvent, StoredEvent } from "./event";
import type { EventStore } from "./event-store";

export class InMemoryEventStore implements EventStore {
  private readonly events: StoredEvent[] = [];

  async append(pending: readonly PendingEvent[]): Promise<StoredEvent[]> {
    const stored = pending.map((event, index) => ({ ...event, sequence: this.events.length + index + 1 }));
    this.events.push(...stored);
    return stored;
  }

  async readAfter(sequence: number): Promise<StoredEvent[]> {
    return this.events.filter((event) => event.sequence > sequence);
  }
}
