import { z } from "zod";
import type { Id } from "../../kernel";

export type CommandsChangeId = Id<"cmd">;
export type CommandsChangeStatus = "pending" | "signed" | "discarded";

const MAX_COMMAND = 200;
const MAX_VERIFY_COMMANDS = 5;

export const ProjectCommandsSchema = z.object({
  setupCommand: z.string().trim().min(1).max(MAX_COMMAND).nullable(),
  verifyCommands: z.array(z.string().trim().min(1).max(MAX_COMMAND)).min(1, "a project needs at least one verify command").max(MAX_VERIFY_COMMANDS),
});

export type ProjectCommands = z.infer<typeof ProjectCommandsSchema>;

export interface CommandsChange extends ProjectCommands {
  readonly id: CommandsChangeId;
  readonly projectId: string;
  readonly reason: string;
  readonly status: CommandsChangeStatus;
  readonly proposedAt: string;
}

export type CommandsEvent =
  | { type: "projects.commands_proposed"; payload: { changeId: CommandsChangeId; projectId: string; setupCommand: string | null; verifyCommands: string[]; reason: string } }
  | { type: "projects.commands_signed"; payload: { changeId: CommandsChangeId; projectId: string } }
  | { type: "projects.commands_discarded"; payload: { changeId: CommandsChangeId; projectId: string } };

export interface CommandsError {
  readonly kind: "not_found" | "invalid";
  readonly message: string;
}
