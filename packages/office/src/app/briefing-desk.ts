import { err, ok } from "../kernel";
import type { BriefingDesk } from "../manager";
import type { BriefingService } from "../projects";

export function createBriefingDesk(service: BriefingService, projectId: string): BriefingDesk {
  return {
    async propose({ text, reason }) {
      const result = await service.propose(projectId, text, reason);
      return result.ok ? ok({ text: `Briefing change ${result.value.id}. It takes effect when you sign it in the Team panel.` }) : err(result.error.message);
    },
  };
}
