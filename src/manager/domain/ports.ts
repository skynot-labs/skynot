import type { z } from "zod";
import type { Result } from "../../kernel";

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
