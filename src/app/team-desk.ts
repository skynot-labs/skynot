import { err, ok } from "../kernel";
import type { TeamDesk } from "../manager";
import type { RosterProjection, TeamService } from "../team";

export function createTeamDesk(service: TeamService, roster: RosterProjection): TeamDesk {
  return {
    hireable: () => roster.hireable(),
    async propose(proposal) {
      const result = await service.propose(proposal);
      if (!result.ok) return err(result.error.message);
      const verb = proposal.action === "hire" ? "hire" : "dismiss";
      return ok({ text: `Team change ${result.value.id}: ${verb} ${proposal.role}. It takes effect when you sign it in the Team panel.` });
    },
  };
}
