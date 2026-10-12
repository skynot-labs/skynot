import type { z } from "zod";
import { err, type Result } from "../../kernel";

export interface ModelRunner {
  ask(input: { system: string; prompt: string; schema: z.ZodType }): Promise<Result<unknown, string>>;
}

export interface OrderOverview {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly plan: string;
}

export interface OrderDesk {
  readonly specSchema: z.ZodType;
  // The orders are proposed together, as one plan the director signs once; `replaces` withdraws an unsigned plan in the same step.
  propose(specs: readonly unknown[], link?: { ticket?: number; replaces?: string }): Promise<Result<{ id: string; card: string }, string>>;
  overview(): OrderOverview[];
}

export interface AdvisorInfo {
  readonly name: string;
  readonly description: string;
}

export interface AdvisorRequest {
  readonly role: string;
  readonly question: string;
}

export interface AdvisorReply {
  readonly role: string;
  readonly result: Result<string, string>;
}

export interface AdvisorBench {
  roster(): AdvisorInfo[];
  consult(requests: readonly AdvisorRequest[]): Promise<AdvisorReply[]>;
}

export const NO_ADVISORS: AdvisorBench = { roster: () => [], consult: async () => [] };

// The director's private notes about the project, which must not reach the repository.
export interface BriefingSource {
  read(): Promise<string | null>;
}

export interface TeamProposal {
  readonly action: "hire" | "dismiss" | "refocus";
  readonly role: string;
  readonly reason: string;
  readonly focus?: string;
}

export interface TeamDesk {
  hireable(): AdvisorInfo[];
  propose(proposal: TeamProposal): Promise<Result<{ text: string }, string>>;
}

export const NO_TEAM_DESK: TeamDesk = { hireable: () => [], propose: async () => err("there is no team to change") };

export interface BriefingDesk {
  propose(proposal: { text: string; reason: string }): Promise<Result<{ text: string }, string>>;
}

export const NO_BRIEFING_DESK: BriefingDesk = { propose: async () => err("the briefing cannot be changed here") };

export interface WaitingWorker {
  readonly orderId: string;
  readonly question: string;
}

export interface Relay {
  readonly orderId: string;
  readonly text: string;
  // "director" passes the director's own words on; "manager" is the Manager's decision and is recorded as such.
  readonly from: "director" | "manager";
}

export interface WorkerDesk {
  waiting(): WaitingWorker[];
  inReview(): string[];
  passOn(relay: Relay): Promise<Result<void, string>>;
}

export const NO_WORKER_DESK: WorkerDesk = { waiting: () => [], inReview: () => [], passOn: async () => err("there is no worker to write to") };
