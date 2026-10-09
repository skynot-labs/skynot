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
