import type { Id } from "../id";

export interface DomainEvent {
  readonly type: string;
  readonly payload: unknown;
}

export interface StoredEvent extends DomainEvent {
  readonly sequence: number;
  readonly id: Id<"evt">;
  readonly occurredAt: string;
}

export type PendingEvent = Omit<StoredEvent, "sequence">;
