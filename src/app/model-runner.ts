import { err, ok } from "../kernel";
import { toEngineSchema, type EngineName, type EngineRequest, type RunScheduler } from "../execution";
import type { ModelRunner } from "../manager";

export interface ManagerEngineOptions {
  engine: EngineName;
  cwd: string;
  timeoutMs: number;
  model?: string;
  maxUsd?: number;
}

export function createManagerRunner(scheduler: RunScheduler, options: ManagerEngineOptions): ModelRunner {
  return {
    async ask({ system, prompt, schema }) {
      const request: EngineRequest = {
        prompt,
        system,
        cwd: options.cwd,
        access: "read",
        schema: toEngineSchema(schema),
        timeoutMs: options.timeoutMs,
        ...(options.model && { model: options.model }),
        ...(options.maxUsd && { maxUsd: options.maxUsd }),
      };

      const outcome = await scheduler.submit({ role: "manager", engine: options.engine, orderId: null, request });
      return outcome.ok ? ok(outcome.value.structured ?? parseJson(outcome.value.text)) : err(outcome.error.message);
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
