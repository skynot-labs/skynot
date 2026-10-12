import type { WorkerRunner } from "../delivery";
import type { RunScheduler } from "../execution";
import { err, ok } from "../kernel";
import type { RoleSetup } from "../team";

export interface WorkerEngineOptions {
  workers: (orderId: string) => Record<string, RoleSetup>;
  projectOf?: (orderId: string) => string | undefined;
  assigneeOf: (orderId: string) => string | null;
}

export const DEFAULT_WORKER = "developer";

export function createWorkerRunner(scheduler: RunScheduler, options: WorkerEngineOptions): WorkerRunner {
  return {
    async work({ orderId, prompt, cwd, allowedCommands, timeoutMs, maxUsd, signal }) {
      const name = options.assigneeOf(orderId) ?? DEFAULT_WORKER;
      const worker = options.workers(orderId)[name];
      if (!worker) return err(`there is no worker ${name}`);

      const outcome = await scheduler.submit({
        role: name,
        engine: worker.engine,
        orderId,
        ...(options.projectOf?.(orderId) && { projectId: options.projectOf(orderId)! }),
        request: {
          prompt,
          cwd,
          access: "write",
          allowedCommands,
          timeoutMs,
          maxUsd,
          ...(signal && { signal }),
          ...(worker.model && { model: worker.model }),
        },
      });
      return outcome.ok ? ok({ report: outcome.value.text, costUsd: outcome.value.costUsd }) : err(outcome.error.message);
    },
  };
}
