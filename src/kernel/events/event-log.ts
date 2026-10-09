import type { Clock } from "../clock";
import { newId } from "../id";
import type { DomainEvent, StoredEvent } from "./event";
import type { EventStore } from "./event-store";

export type EventHandler = (event: StoredEvent) => void | Promise<void>;
export type HandlerErrorReporter = (error: unknown, event: StoredEvent) => void;

export class EventLog {
  private readonly handlers = new Set<EventHandler>();
  private dispatchTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock,
    private readonly reportHandlerError: HandlerErrorReporter = () => {},
  ) {}

  async record(events: readonly DomainEvent[]): Promise<StoredEvent[]> {
    const occurredAt = this.clock.now().toISOString();
    const stored = await this.store.append(
      events.map((event) => ({ id: newId("evt"), occurredAt, type: event.type, payload: event.payload })),
    );
    await this.enqueueDispatch(stored);
    return stored;
  }

  readAfter(sequence: number): Promise<StoredEvent[]> {
    return this.store.readAfter(sequence);
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private enqueueDispatch(events: readonly StoredEvent[]): Promise<void> {
    this.dispatchTail = this.dispatchTail.then(async () => {
      for (const event of events) await this.deliver(event);
    });
    return this.dispatchTail;
  }

  private async deliver(event: StoredEvent): Promise<void> {
    for (const handler of [...this.handlers]) {
      try {
        await handler(event);
      } catch (error) {
        this.reportHandlerError(error, event);
      }
    }
  }
}
