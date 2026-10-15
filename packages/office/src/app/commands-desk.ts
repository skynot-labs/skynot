import { err, ok } from "../kernel";
import type { CommandsDesk } from "../manager";
import type { CommandsService, Project, ProjectCommands } from "../projects";

export function createCommandsDesk(service: CommandsService, project: Project, signed: ReadonlyMap<string, ProjectCommands>): CommandsDesk {
  return {
    current() {
      const { setupCommand, verifyCommands } = signed.get(project.id) ?? project;
      return { setup: setupCommand, verify: verifyCommands };
    },
    async propose({ setup, verify, reason }) {
      const result = await service.propose(project.id, { setupCommand: setup, verifyCommands: [...verify] }, reason);
      return result.ok ? ok({ text: `New commands ${result.value.id}. They take effect for the next order when you sign them.` }) : err(result.error.message);
    },
  };
}
