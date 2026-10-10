import type { Board, BoardStage } from "../delivery";
import type { EventLog, StoredEvent } from "../kernel/events";
import type { WorkOrder } from "../orders";

export interface BoardMirrorDependencies {
  log: EventLog;
  findOrder(id: string): WorkOrder | undefined;
  issueUrlOf(orderId: string): string | null;
  ticketUrlOf(order: WorkOrder): string | null;
  boardOf(projectId: string): Board | undefined;
  onError?: (error: unknown, event: StoredEvent) => void;
}

const STAGE_OF: Record<string, BoardStage> = {
  "orders.work_started": "in_progress",
  "orders.pull_request_opened": "in_review",
  "orders.delivered": "done",
};

// One way only: the log is the truth and the board shows it. A board that cannot be written never stops the work.
export class BoardMirror {
  private readonly moving = new Map<string, Promise<void>>();

  constructor(private readonly deps: BoardMirrorDependencies) {}

  start(): () => void {
    return this.deps.log.subscribe((event) => this.react(event));
  }

  private react(event: StoredEvent): void {
    const fail = (error: unknown) => this.deps.onError?.(error, event);
    if (event.type === "intake.ticket_taken") {
      const { projectId, url } = event.payload as { projectId: string; url: string };
      const board = this.deps.boardOf(projectId);
      if (board) this.move(board, url, "proposed", fail);
      return;
    }
    const stage = STAGE_OF[event.type];
    if (!stage) return;

    const order = this.deps.findOrder((event.payload as { orderId: string }).orderId);
    const board = order && this.deps.boardOf(order.projectId);
    if (!order || !board) return;
    const issueUrl = this.deps.issueUrlOf(order.id);
    const cards = [issueUrl, this.deps.ticketUrlOf(order)].filter((url): url is string => url !== null);
    for (const url of cards) this.move(board, url, stage, fail);
  }

  // Events come fast and each move is two gh calls: a card takes its moves in the order the events happened.
  private move(board: Board, url: string, stage: BoardStage, fail: (error: unknown) => void): void {
    const previous = this.moving.get(url) ?? Promise.resolve();
    const next = previous.then(() => board.place({ url, stage })).catch(fail);
    this.moving.set(url, next);
    void next.then(() => this.moving.get(url) === next && this.moving.delete(url));
  }
}
