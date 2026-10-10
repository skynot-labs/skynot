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
  controller: AbortController;
  resolve: (outcome: Outcome) => void;
}

const stopped = (): Outcome => err({ kind: "cancelled", message: "the run was stopped" });

export class RunScheduler {
  private readonly waiting: Job[] = [];
  private readonly active = new Map<RunId, Job>();
  private running = 0;

  constructor(
    private readonly engines: Partial<Record<EngineName, RoleEngine>>,
    private readonly log: EventLog,
    private readonly maxParallel: number,
    private readonly paused: () => boolean = () => false,
  ) {
    // after the projections that decide whether the shop is paused have seen the event
    log.subscribe((event) => {
      if (event.type === "control.resumed") queueMicrotask(() => this.pump());
    });
  }

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
      const controller = new AbortController();
      const request = { ...submission.request, signal: controller.signal };
      this.waiting.push({ runId, submission: { ...submission, request }, controller, resolve });

      const outer = submission.request.signal;
      const stop = () => void this.cancel(runId);
      if (outer?.aborted) stop();
      else outer?.addEventListener("abort", stop, { once: true });
      this.pump();
    });
  }

  // A queued run leaves the queue; a running one has its process killed. False when the run is not live.
  async cancel(runId: string): Promise<boolean> {
    const queued = this.waiting.findIndex((job) => job.runId === runId);
    if (queued >= 0) {
      const [job] = this.waiting.splice(queued, 1);
      job!.controller.abort();
      const outcome = stopped();
      await this.log.record([finishedEvent(job!.runId, outcome)]);
      job!.resolve(outcome);
      return true;
    }
    const job = this.active.get(runId as RunId);
    if (!job) return false;
    job.controller.abort();
    return true;
  }

  private pump(): void {
    while (!this.paused() && this.running < this.maxParallel && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.running++;
      this.active.set(job.runId, job);
      void this.execute(job).finally(() => {
        this.active.delete(job.runId);
        this.running--;
        this.pump();
      });
    }
  }

  private async execute({ runId, submission, controller, resolve }: Job): Promise<void> {
    let outcome: Outcome;
    try {
      await this.log.record([{ type: "execution.run_started", payload: { runId } }]);
      outcome = controller.signal.aborted ? stopped() : await this.runEngine(submission);
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
