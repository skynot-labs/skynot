import type { Id } from "../../kernel";

export type BriefingChangeId = Id<"brf">;
export type BriefingChangeStatus = "pending" | "signed" | "discarded";

export const MAX_BRIEFING_CHANGE = 1500;

export interface BriefingChange {
  readonly id: BriefingChangeId;
  readonly projectId: string;
  readonly text: string;
  readonly reason: string;
  readonly status: BriefingChangeStatus;
  readonly proposedAt: string;
}

export type BriefingEvent =
  | { type: "projects.briefing_proposed"; payload: { changeId: BriefingChangeId; projectId: string; text: string; reason: string } }
  | { type: "projects.briefing_signed"; payload: { changeId: BriefingChangeId; projectId: string } }
  | { type: "projects.briefing_discarded"; payload: { changeId: BriefingChangeId; projectId: string } };

export interface BriefingError {
  readonly kind: "not_found" | "invalid";
  readonly message: string;
}
