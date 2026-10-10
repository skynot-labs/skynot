import type { Ticket, Vcs } from "../delivery";
import type { EventLog, Projection, StoredEvent } from "../kernel/events";

const MAX_PER_POLL = 3;

// Tickets the shop already took, so a restart or a second poll never takes one twice.
export class IntakeProjection implements Projection {
  private readonly taken = new Set<string>();

  apply(event: StoredEvent): void {
    if (event.type !== "intake.ticket_taken") return;
    const { projectId, ticket } = event.payload as { projectId: string; ticket: number };
    this.taken.add(`${projectId}#${ticket}`);
  }

  has(projectId: string, ticket: number): boolean {
    return this.taken.has(`${projectId}#${ticket}`);
  }
}

export interface IntakeTarget {
  readonly projectId: string;
  readonly repo: string;
  handle(ticket: Ticket): Promise<void>;
}

export interface IntakeDependencies {
  log: EventLog;
  vcs: Vcs;
  intake: IntakeProjection;
  targets: () => readonly IntakeTarget[];
  label: string;
  onError?: (error: unknown) => void;
}

// The director labels an issue; the Manager of that project reads it and proposes an order, or asks. Never starts work.
export class IntakeWatcher {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(private readonly deps: IntakeDependencies) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => void this.poll(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const target of this.deps.targets()) await this.pollProject(target);
    } finally {
      this.polling = false;
    }
  }

  private async pollProject({ projectId, repo, handle }: IntakeTarget): Promise<void> {
    const { vcs, intake, log, label, onError } = this.deps;
    let tickets: Ticket[];
    try {
      tickets = await vcs.listTickets(repo, label);
    } catch {
      return;
    }
    for (const ticket of tickets.filter((candidate) => !intake.has(projectId, candidate.number)).slice(0, MAX_PER_POLL)) {
      await log.record([{ type: "intake.ticket_taken", payload: { projectId, ticket: ticket.number, title: ticket.title, url: ticket.url } }]);
      await handle(ticket).catch((error) => onError?.(error));
    }
  }
}
