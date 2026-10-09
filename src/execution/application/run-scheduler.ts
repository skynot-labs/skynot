import { err, newId, type Result } from "../../kernel";
import type { EventLog } from "../../kernel/events";
import type { EngineFailure, EngineName, EngineRequest, EngineResult, RoleEngine, RunId } from "../domain";

export interface RunSubmission {
  role: string;
  engine: EngineName;
  orderId: string | null;
  request: EngineRequest;
}

type Outcome = Result<EngineResult, EngineFailure>;

interface Job {
  runId: RunId;
  submission: RunSubmission;
  resolve: (outcome: Outcome) => void;
}

export class RunScheduler {
  private readonly waiting: Job[] = [];
  private running = 0;

  constructor(
    private readonly engines: Partial<Record<EngineName, RoleEngine>>,
    private readonly log: EventLog,
    private readonly maxParallel: number,
  ) {}

  async submit(submission: RunSubmission): Promise<Outcome> {
    const runId = newId("run");
    await this.log.record([
      {
        type: "execution.run_requested",
        payload: {
          runId,
          role: submission.role,
          engine: submission.engine,
          access: submission.request.access,
          orderId: submission.orderId,
        },
      },
    ]);

    return new Promise((resolve) => {
      this.waiting.push({ runId, submission, resolve });
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < this.maxParallel && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.running++;
      void this.execute(job).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async execute({ runId, submission, resolve }: Job): Promise<void> {
    let outcome: Outcome;
    try {
      await this.log.record([{ type: "execution.run_started", payload: { runId } }]);
      outcome = await this.runEngine(submission);
      await this.log.record([finishedEvent(runId, outcome)]);
    } catch (error) {
      outcome = err({ kind: "failed", message: `the run could not be recorded: ${(error as Error).message}` });
    }
    resolve(outcome);
  }

  private async runEngine({ engine: name, request }: RunSubmission): Promise<Outcome> {
    const engine = this.engines[name];
    if (!engine) return err({ kind: "engine_unavailable", message: `no ${name} engine is configured` });

    try {
      return await engine.run(request);
    } catch (error) {
      return err({ kind: "failed", message: (error as Error).message });
    }
  }
}

function finishedEvent(runId: RunId, outcome: Outcome) {
  return outcome.ok
    ? {
        type: "execution.run_completed",
        payload: { runId, costUsd: outcome.value.costUsd, turns: outcome.value.turns, model: outcome.value.model },
      }
    : { type: "execution.run_failed", payload: { runId, failure: outcome.error } };
}
