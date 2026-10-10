import { err, newId, ok, type Result } from "../../kernel";
import type { EventLog } from "../../kernel/events";
import type { ChangeId, TeamAction, TeamChange, TeamError } from "../domain";
import type { RosterProjection } from "./roster-projection";

type ChangeResult = Result<TeamChange, TeamError>;

export interface Proposal {
  action: TeamAction;
  role: string;
  reason: string;
}

export class TeamService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly log: EventLog,
    private readonly roster: RosterProjection,
  ) {}

  propose(proposal: Proposal): Promise<ChangeResult> {
    return this.exclusive(async () => {
      const problem = this.problemWith(proposal);
      if (problem) return invalid(problem);

      const changeId = newId("chg");
      await this.log.record([{ type: "team.change_proposed", payload: { changeId, ...proposal } }]);
      return ok(this.roster.change(changeId)!);
    });
  }

  sign(id: string): Promise<ChangeResult> {
    return this.settle(id, "team.change_signed");
  }

  discard(id: string): Promise<ChangeResult> {
    return this.settle(id, "team.change_discarded");
  }

  private settle(id: string, type: "team.change_signed" | "team.change_discarded"): Promise<ChangeResult> {
    return this.exclusive(async () => {
      const change = this.roster.change(id);
      if (!change) return err({ kind: "not_found", message: `no team change ${id}` });
      if (change.status !== "pending") return invalid(`${id} is already ${change.status}`);
      if (type === "team.change_signed") {
        const problem = this.problemWith(change, change.id);
        if (problem) return invalid(problem);
      }

      await this.log.record([{ type, payload: { changeId: change.id, action: change.action, role: change.role } }]);
      return ok(this.roster.change(id)!);
    });
  }

  private problemWith({ action, role }: Proposal, ignoring?: ChangeId): string | null {
    if (action === "hire" && !this.roster.hireable().some((candidate) => candidate.name === role)) return `${role} cannot be hired: it is not in the library or already on the team`;
    if (action === "dismiss" && !this.roster.isMember(role)) return `${role} cannot be dismissed: it is not on the team`;
    if (this.roster.pending().some((change) => change.role === role && change.id !== ignoring)) return `there is already a pending change for ${role}`;
    return null;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

const invalid = (message: string) => err<TeamError>({ kind: "invalid", message });
