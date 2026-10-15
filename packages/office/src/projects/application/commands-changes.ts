import { err, newId, ok, type Result } from "../../kernel";
import type { EventRecorder, Projection, StoredEvent } from "../../kernel/events";
import { ProjectCommandsSchema, type CommandsChange, type CommandsChangeId, type CommandsError, type CommandsEvent, type ProjectCommands, type ProjectCommandsWriter } from "../domain";

export class CommandsChanges implements Projection {
  private readonly changes = new Map<CommandsChangeId, CommandsChange>();

  apply(stored: StoredEvent): void {
    if (!stored.type.startsWith("projects.commands_")) return;
    const event = stored as StoredEvent & CommandsEvent;
    const { changeId } = event.payload;

    if (event.type === "projects.commands_proposed") {
      const { projectId, setupCommand, verifyCommands, reason } = event.payload;
      this.changes.set(changeId, { id: changeId, projectId, setupCommand, verifyCommands, reason, status: "pending", proposedAt: stored.occurredAt });
      return;
    }
    const change = this.changes.get(changeId);
    if (change) this.changes.set(changeId, { ...change, status: event.type === "projects.commands_signed" ? "signed" : "discarded" });
  }

  pendingFor(projectId: string): CommandsChange[] {
    return [...this.changes.values()].filter((change) => change.projectId === projectId && change.status === "pending");
  }

  get(id: string): CommandsChange | undefined {
    return this.changes.get(id as CommandsChangeId);
  }
}

type Result_ = Result<CommandsChange, CommandsError>;

export class CommandsService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly log: EventRecorder,
    private readonly changes: CommandsChanges,
    private readonly writer: ProjectCommandsWriter,
  ) {}

  propose(projectId: string, commands: ProjectCommands, reason: string): Promise<Result_> {
    return this.exclusive(async () => {
      const parsed = ProjectCommandsSchema.safeParse(commands);
      if (!parsed.success) return invalid(parsed.error.issues.map((issue) => issue.message).join("; "));
      if (this.changes.pendingFor(projectId).length > 0) return invalid("there is already a change of commands waiting for the director");

      const changeId: CommandsChangeId = newId("cmd");
      await this.log.record([{ type: "projects.commands_proposed", payload: { changeId, projectId, ...parsed.data, reason } }]);
      return ok(this.changes.get(changeId)!);
    });
  }

  // The file is written first: a signature that could not be kept is not recorded.
  sign(id: string): Promise<Result_> {
    return this.settle(id, "projects.commands_signed", async (change) => {
      const written = await this.writer.write(change.projectId, { setupCommand: change.setupCommand, verifyCommands: change.verifyCommands });
      return written.ok ? undefined : written.error;
    });
  }

  discard(id: string): Promise<Result_> {
    return this.settle(id, "projects.commands_discarded", async () => undefined);
  }

  private settle(id: string, type: "projects.commands_signed" | "projects.commands_discarded", before: (change: CommandsChange) => Promise<string | undefined>): Promise<Result_> {
    return this.exclusive(async () => {
      const change = this.changes.get(id);
      if (!change) return err({ kind: "not_found", message: `no change of commands ${id}` });
      if (change.status !== "pending") return invalid(`${id} is already ${change.status}`);
      const refused = await before(change);
      if (refused) return invalid(refused);

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

const invalid = (message: string) => err<CommandsError>({ kind: "invalid", message });
