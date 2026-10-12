import { err, ok, type Result } from "../../kernel";
import type { EventLog, Projection, StoredEvent } from "../../kernel/events";

const pausers = ["director", "cost_cap"] as const;
export type PausedBy = (typeof pausers)[number];

// A log is a file anyone can have written: a pauser this office does not know is dropped, not passed on.
function byOf(event: StoredEvent): { by?: PausedBy } {
  const recorded: unknown = event.payload;
  const named = typeof recorded === "object" && recorded !== null && "by" in recorded ? recorded.by : undefined;
  const by = pausers.find((known) => known === named);
  return by ? { by } : {};
}

export interface PauseState {
  readonly since: string;
  readonly reason: string;
  readonly by?: PausedBy;
}

// While paused the shop, or one project, starts no new run; the ones in progress finish. A pause survives a restart.
export class ShopControl implements Projection {
  private state: PauseState | null = null;
  private readonly projects = new Map<string, PauseState>();
  private lastCapDay: string | null = null;

  constructor(private readonly log: EventLog) {}

  apply(event: StoredEvent): void {
    if (event.type === "control.paused") {
      const { reason, capDay } = event.payload as { reason: string; capDay?: string };
      this.state = { since: event.occurredAt, reason, ...byOf(event) };
      if (capDay) this.lastCapDay = capDay;
    }
    if (event.type === "control.resumed") this.state = null;
    if (event.type === "control.project_paused") {
      const { projectId, reason } = event.payload as { projectId: string; reason: string };
      this.projects.set(projectId, { since: event.occurredAt, reason, ...byOf(event) });
    }
    if (event.type === "control.project_resumed") this.projects.delete((event.payload as { projectId: string }).projectId);
  }

  paused(): PauseState | null {
    return this.state;
  }

  projectPaused(projectId: string): PauseState | null {
    return this.projects.get(projectId) ?? null;
  }

  // What holds a run back: the shop pause first, then its project's.
  pausedFor(projectId?: string): PauseState | null {
    return this.state ?? (projectId === undefined ? null : this.projectPaused(projectId));
  }

  // The day the cost cap last paused the shop, so a resume on that day is not undone by the same cap.
  capDay(): string | null {
    return this.lastCapDay;
  }

  async pause(reason: string, by: PausedBy, capDay?: string): Promise<Result<PauseState, string>> {
    if (this.state) return err("the shop is already paused");
    await this.log.record([{ type: "control.paused", payload: { reason, by, ...(capDay && { capDay }) } }]);
    return ok(this.state!);
  }

  async resume(): Promise<Result<null, string>> {
    if (!this.state) return err("the shop is not paused");
    await this.log.record([{ type: "control.resumed", payload: {} }]);
    return ok(null);
  }

  async pauseProject(projectId: string, reason: string, by: PausedBy): Promise<Result<PauseState, string>> {
    if (this.projects.has(projectId)) return err("the project is already paused");
    await this.log.record([{ type: "control.project_paused", payload: { projectId, reason, by } }]);
    return ok(this.projects.get(projectId)!);
  }

  async resumeProject(projectId: string): Promise<Result<null, string>> {
    if (!this.projects.has(projectId)) return err("the project is not paused");
    await this.log.record([{ type: "control.project_resumed", payload: { projectId } }]);
    return ok(null);
  }
}
