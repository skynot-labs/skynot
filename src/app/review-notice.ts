import type { EventLog, StoredEvent } from "../kernel/events";

export interface ReviewNoticeDependencies {
  log: EventLog;
  say(text: string, orderId: string): Promise<void>;
  onError?: (error: unknown, event: StoredEvent) => void;
}

// A review that still asks for changes after the automatic round is the director's call; they should hear it.
export class ReviewNotice {
  constructor(private readonly deps: ReviewNoticeDependencies) {}

  start(): () => void {
    return this.deps.log.subscribe((event) => this.react(event));
  }

  private react(event: StoredEvent): void {
    if (event.type !== "delivery.review_completed") return;

    const { orderId, round, verdict, summary } = event.payload as { orderId: string; round: number; verdict: string; summary: string };
    if (verdict !== "changes_requested" || round < 2) return;
    void this.deps
      .say(`The reviewer still asks for changes on ${orderId} after ${round} rounds: ${summary} Send a follow-up from its card, or merge it anyway on GitHub.`, orderId)
      .catch((error) => this.deps.onError?.(error, event));
  }
}
