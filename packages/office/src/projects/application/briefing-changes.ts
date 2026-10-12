import { err, newId, ok, type Result } from "../../kernel";
import type { EventRecorder, Projection, StoredEvent } from "../../kernel/events";
import { MAX_BRIEFING_CHANGE, type BriefingChange, type BriefingChangeId, type BriefingError, type BriefingEvent, type BriefingStore } from "../domain";

// What the director signed overrides the briefing file; the file stays as written.
export class BriefingChanges implements Projection {
  private readonly changes = new Map<BriefingChangeId, BriefingChange>();
  private readonly current = new Map<string, string>();

  apply(stored: StoredEvent): void {
    if (!stored.type.startsWith("projects.briefing_")) return;
    const event = stored as StoredEvent & BriefingEvent;
    const { changeId } = event.payload;

    if (event.type === "projects.briefing_proposed") {
      this.changes.set(changeId, { id: changeId, projectId: event.payload.projectId, text: event.payload.text, reason: event.payload.reason, status: "pending", proposedAt: stored.occurredAt });
      return;
    }
    const change = this.changes.get(changeId);
    if (!change) return;
    this.changes.set(changeId, { ...change, status: event.type === "projects.briefing_signed" ? "signed" : "discarded" });
    if (event.type === "projects.briefing_signed") this.current.set(change.projectId, change.text);
  }

  signedFor(projectId: string): string | null {
    return this.current.get(projectId) ?? null;
  }

  pendingFor(projectId: string): BriefingChange[] {
    return [...this.changes.values()].filter((change) => change.projectId === projectId && change.status === "pending");
  }

  get(id: string): BriefingChange | undefined {
    return this.changes.get(id as BriefingChangeId);
  }
}

export function withSignedChanges(file: BriefingStore, changes: BriefingChanges, maxChars: number): BriefingStore {
  return { read: async (projectId) => changes.signedFor(projectId)?.slice(0, maxChars) ?? file.read(projectId) };
}

type Result_ = Result<BriefingChange, BriefingError>;

export class BriefingService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly log: EventRecorder,
    private readonly changes: BriefingChanges,
  ) {}

  propose(projectId: string, text: string, reason: string): Promise<Result_> {
    return this.exclusive(async () => {
      const trimmed = text.trim();
      if (trimmed.length < 3 || trimmed.length > MAX_BRIEFING_CHANGE) return invalid(`the briefing must have between 3 and ${MAX_BRIEFING_CHANGE} characters`);
      if (this.changes.pendingFor(projectId).length > 0) return invalid("there is already a briefing change waiting for the director");

      const changeId: BriefingChangeId = newId("brf");
      await this.log.record([{ type: "projects.briefing_proposed", payload: { changeId, projectId, text: trimmed, reason } }]);
      return ok(this.changes.get(changeId)!);
    });
  }

  sign(id: string): Promise<Result_> {
    return this.settle(id, "projects.briefing_signed");
  }

  discard(id: string): Promise<Result_> {
    return this.settle(id, "projects.briefing_discarded");
  }

  private settle(id: string, type: "projects.briefing_signed" | "projects.briefing_discarded"): Promise<Result_> {
    return this.exclusive(async () => {
      const change = this.changes.get(id);
      if (!change) return err({ kind: "not_found", message: `no briefing change ${id}` });
      if (change.status !== "pending") return invalid(`${id} is already ${change.status}`);

      await this.log.record([{ type, payload: { changeId: change.id, projectId: change.projectId } }]);
      return ok(this.changes.get(id)!);
    });
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

const invalid = (message: string) => err<BriefingError>({ kind: "invalid", message });
