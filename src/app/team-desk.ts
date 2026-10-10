import { err, ok } from "../kernel";
import type { TeamDesk } from "../manager";
import type { RosterProjection, TeamService } from "../team";

export function createTeamDesk(service: TeamService, roster: RosterProjection): TeamDesk {
  return {
    hireable: () => roster.hireable(),
    async propose(proposal) {
      const result = await service.propose(proposal);
      if (!result.ok) return err(result.error.message);
      return ok({ text: `Team change ${result.value.id}: ${proposal.action} ${proposal.role}. It takes effect when you sign it in the Team panel.` });
    },
  };
}
