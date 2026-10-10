import type { EventLog, StoredEvent } from "../kernel/events";
import type { WorkOrder } from "../orders";

export interface BlockedNoticeDependencies {
  log: EventLog;
  say(text: string, orderId: string): Promise<void>;
  findOrder(id: string): WorkOrder | undefined;
  protectedPathsOf(id: string): readonly string[];
  onError?: (error: unknown, event: StoredEvent) => void;
}

// A blocked order used to show only on its card; the director also hears it in the chat.
export class BlockedNotice {
  constructor(private readonly deps: BlockedNoticeDependencies) {}

  start(): () => void {
    return this.deps.log.subscribe((event) => this.react(event));
  }

  private react(event: StoredEvent): void {
    if (event.type !== "delivery.work_blocked") return;

    const { orderId, reason } = event.payload as { orderId: string; reason: string };
    void this.deps.say(`${orderId} is blocked: ${reason}. ${this.whatNext(orderId)}`, orderId).catch((error) => this.deps.onError?.(error, event));
  }

  private whatNext(orderId: string): string {
    if (this.deps.protectedPathsOf(orderId).length > 0) return "Approve those paths on its card, or make the change yourself on GitHub.";
    switch (this.deps.findOrder(orderId)?.status) {
      case "signed":
      case "on_bench":
        return "Retry or discard it from its card.";
      case "in_review":
        return "Send a follow-up from its card, or close the pull request.";
      default:
        return "";
    }
  }
}
