import type { Id } from "../../kernel";
import type { DomainEvent } from "../../kernel/events";

export type ChangeId = Id<"chg">;
export type TeamAction = "hire" | "dismiss" | "refocus";
export type ChangeStatus = "pending" | "signed" | "discarded";

export interface TeamChange {
  readonly id: ChangeId;
  readonly action: TeamAction;
  readonly role: string;
  readonly reason: string;
  readonly focus: string | null;
  readonly status: ChangeStatus;
  readonly proposedAt: string;
}

export type TeamEvent =
  | { type: "team.change_proposed"; payload: { changeId: ChangeId; action: TeamAction; role: string; reason: string; focus?: string } }
  | { type: "team.change_signed"; payload: { changeId: ChangeId; action: TeamAction; role: string; focus?: string } }
  | { type: "team.change_discarded"; payload: { changeId: ChangeId; action: TeamAction; role: string } };

export interface TeamError {
  readonly kind: "not_found" | "invalid";
  readonly message: string;
}

export function asTeamEvent(event: DomainEvent): TeamEvent | null {
  return event.type.startsWith("team.") ? (event as TeamEvent) : null;
}
