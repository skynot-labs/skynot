import { inScope, type Projection, type ProjectScope, type StoredEvent } from "../../kernel/events";
import { asTeamEvent, type Advisor, type ChangeId, type Team, type TeamChange } from "../domain";

export interface RoleSummary {
  readonly name: string;
  readonly description: string;
}

export interface RoleProfile {
  readonly role: string;
  readonly description: string;
  readonly soul: string;
  readonly focus: string | null;
}

// The team file says who is known and who starts on the team; signed changes move people in and out.
export class RosterProjection implements Projection {
  private readonly known: Record<string, Advisor>;
  private readonly onTeam: Set<string>;
  private readonly changes = new Map<ChangeId, TeamChange>();
  private readonly foci = new Map<string, string>();

  constructor(
    team: Pick<Team, "advisors" | "library">,
    private readonly scope?: ProjectScope,
  ) {
    this.known = { ...team.library, ...team.advisors };
    this.onTeam = new Set(Object.keys(team.advisors));
  }

  apply(stored: StoredEvent): void {
    const event = asTeamEvent(stored);
    if (!event || !inScope(stored, this.scope)) return;

    const { changeId } = event.payload;
    switch (event.type) {
      case "team.change_proposed":
        this.changes.set(changeId, {
          id: changeId,
          action: event.payload.action,
          role: event.payload.role,
          reason: event.payload.reason,
          focus: event.payload.focus ?? null,
          status: "pending",
          proposedAt: stored.occurredAt,
        });
        break;
      case "team.change_signed":
        this.settle(changeId, "signed");
        if (event.payload.action === "hire") this.onTeam.add(event.payload.role);
        else if (event.payload.action === "dismiss") this.onTeam.delete(event.payload.role);
        else if (event.payload.focus) this.foci.set(event.payload.role, event.payload.focus);
        break;
      case "team.change_discarded":
        this.settle(changeId, "discarded");
        break;
    }
  }

  members(): Record<string, Advisor> {
    return Object.fromEntries([...this.onTeam].filter((name) => name in this.known).map((name) => [name, this.withFocus(name)]));
  }

  profiles(): RoleProfile[] {
    return [...this.onTeam]
      .filter((name) => name in this.known)
      .map((name) => ({ role: name, description: this.known[name]!.description, soul: this.known[name]!.soul, focus: this.foci.get(name) ?? null }));
  }

  isMember(role: string): boolean {
    return this.onTeam.has(role) && role in this.known;
  }

  hireable(): RoleSummary[] {
    return Object.entries(this.known)
      .filter(([name]) => !this.onTeam.has(name))
      .map(([name, advisor]) => ({ name, description: advisor.description }));
  }

  pending(): TeamChange[] {
    return [...this.changes.values()].filter((change) => change.status === "pending");
  }

  change(id: string): TeamChange | undefined {
    return this.changes.get(id as ChangeId);
  }

  // The soul on file stays as it is; what the director added is appended, so removing the focus means editing the log's last word, not a file.
  private withFocus(name: string): Advisor {
    const advisor = this.known[name]!;
    const focus = this.foci.get(name);
    return focus ? { ...advisor, soul: `${advisor.soul}\n\nFocus the director set for this role: ${focus}` } : advisor;
  }

  private settle(id: ChangeId, status: TeamChange["status"]): void {
    const change = this.changes.get(id);
    if (change) this.changes.set(id, { ...change, status });
  }
}
