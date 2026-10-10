import type { z } from "zod";
import { err, type Result } from "../../kernel";

export interface ModelRunner {
  ask(input: { system: string; prompt: string; schema: z.ZodType }): Promise<Result<unknown, string>>;
}

export interface OrderOverview {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

export interface OrderDesk {
  readonly specSchema: z.ZodType;
  propose(spec: unknown): Promise<Result<{ id: string; card: string }, string>>;
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
  readonly action: "hire" | "dismiss";
  readonly role: string;
  readonly reason: string;
}

export interface TeamDesk {
  hireable(): AdvisorInfo[];
  propose(proposal: TeamProposal): Promise<Result<{ text: string }, string>>;
}

export const NO_TEAM_DESK: TeamDesk = { hireable: () => [], propose: async () => err("there is no team to change") };
