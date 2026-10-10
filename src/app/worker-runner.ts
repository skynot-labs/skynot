import type { WorkerRunner } from "../delivery";
import type { EngineName, RunScheduler } from "../execution";
import { err, ok } from "../kernel";

export interface WorkerEngineOptions {
  engine: EngineName;
  model?: string;
}

export function createWorkerRunner(scheduler: RunScheduler, options: WorkerEngineOptions): WorkerRunner {
  return {
    async work({ orderId, prompt, cwd, allowedCommands, timeoutMs, maxUsd, signal }) {
      const outcome = await scheduler.submit({
        role: "developer",
        engine: options.engine,
        orderId,
        request: {
          prompt,
          cwd,
          access: "write",
          allowedCommands,
          timeoutMs,
          maxUsd,
          ...(signal && { signal }),
          ...(options.model && { model: options.model }),
        },
      });
      return outcome.ok ? ok({ report: outcome.value.text, costUsd: outcome.value.costUsd }) : err(outcome.error.message);
    },
  };
}
