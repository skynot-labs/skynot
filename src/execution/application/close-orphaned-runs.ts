import type { EventLog } from "../../kernel/events";
import type { RunsProjection } from "./runs-projection";

// A restart kills every process and drops the queue; runs the log still shows as live can never finish.
export async function closeOrphanedRuns(runs: RunsProjection, log: EventLog): Promise<number> {
  const orphaned = runs.list().filter((run) => run.status === "queued" || run.status === "running");
  for (const run of orphaned) {
    await log.record([{ type: "execution.run_failed", payload: { runId: run.id, failure: { kind: "failed", message: "the shop restarted before this run finished" } } }]);
  }
  return orphaned.length;
}
