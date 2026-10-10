import type { Id } from "../../kernel";
import type { DomainEvent } from "../../kernel/events";
import type { Access, EngineFailure, EngineName, TokenUsage } from "./engine";

export type RunId = Id<"run">;

export type RunStatus = "queued" | "running" | "completed" | "failed";

export type RunOutcome = "completed" | "failed" | "cancelled" | "interrupted";

export interface Run {
  readonly id: RunId;
  readonly role: string;
  readonly engine: EngineName;
  readonly access: Access;
  readonly orderId: string | null;
  readonly projectId: string;
  readonly status: RunStatus;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly costUsd: number | null;
  readonly turns: number | null;
  readonly model: string | null;
  readonly usage: TokenUsage | null;
  readonly failure: EngineFailure | null;
}

export type RunEvent =
  | { type: "execution.run_requested"; payload: { runId: RunId; role: string; engine: EngineName; access: Access; orderId: string | null; projectId?: string } }
  | { type: "execution.run_started"; payload: { runId: RunId } }
  | { type: "execution.run_completed"; payload: { runId: RunId; costUsd: number; turns?: number; model?: string; usage?: TokenUsage } }
  | { type: "execution.run_failed"; payload: { runId: RunId; failure: EngineFailure } };

export function asRunEvent(event: DomainEvent): RunEvent | null {
  return event.type.startsWith("execution.") ? (event as RunEvent) : null;
}

export function evolve(run: Run | null, event: RunEvent, at: string, firstProject = "default"): Run | null {
  if (event.type === "execution.run_requested") {
    const { runId, role, engine, access, orderId, projectId } = event.payload;
    return {
      id: runId,
      role,
      engine,
      access,
      orderId,
      projectId: projectId ?? firstProject,
      status: "queued",
      requestedAt: at,
      startedAt: null,
      finishedAt: null,
      costUsd: null,
      turns: null,
      model: null,
      usage: null,
      failure: null,
    };
  }
  if (!run) return null;

  switch (event.type) {
    case "execution.run_started":
      return { ...run, status: "running", startedAt: at };
    case "execution.run_completed":
      return {
        ...run,
        status: "completed",
        finishedAt: at,
        costUsd: event.payload.costUsd,
        turns: event.payload.turns ?? null,
        model: event.payload.model ?? null,
        usage: event.payload.usage ?? null,
      };
    case "execution.run_failed": {
      const { failure } = event.payload;
      return { ...run, status: "failed", finishedAt: at, costUsd: failure.costUsd ?? null, usage: failure.usage ?? null, failure };
    }
  }
}

export function outcomeOf(run: Run): RunOutcome | null {
  if (run.status === "completed") return "completed";
  if (run.status !== "failed") return null;
  return run.failure?.kind === "cancelled" || run.failure?.kind === "interrupted" ? run.failure.kind : "failed";
}
