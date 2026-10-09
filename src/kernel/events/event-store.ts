import type { PendingEvent, StoredEvent } from "./event";

export interface EventStore {
  append(events: readonly PendingEvent[]): Promise<StoredEvent[]>;
  readAfter(sequence: number): Promise<StoredEvent[]>;
}
