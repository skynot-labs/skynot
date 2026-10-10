import { describe, expect, it } from "vitest";
import { createCodeReviewer } from "../../src/app/code-reviewer";
import { FakeEngine, RunScheduler, RunsProjection } from "../../src/execution";
import { EventLog, InMemoryEventStore, attachProjection } from "../../src/kernel/events";
import { fixedClock } from "../../src/kernel";
import type { WorkItem } from "../../src/delivery";

const item: WorkItem = {
  id: "WO-0001",
  title: "Export CSV",
  objective: "Export the inventory as CSV.",
  criteria: [{ statement: "Archived items are not exported", verification: { kind: "test", detail: "export.test.ts" } }],
  outOfScope: [],
  risk: "low",
  likelyFiles: [],
  card: "",
};

async function reviewerWith(engine: FakeEngine) {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-10T12:00:00.000Z")));
  const runs = new RunsProjection();
  await attachProjection(log, runs);
  const reviewer = createCodeReviewer(new RunScheduler({ codex: engine }, log, 1), { engine: "codex", cwd: async () => "/tmp/base", timeoutMs: 1000, model: "gpt-x" });
  return { reviewer, runs };
}

describe("code reviewer", () => {
  it("reads the repository, gets the order and the diff, and returns the verdict", async () => {
    const engine = new FakeEngine(() => ({ structured: { verdict: "changes_requested", summary: "No test.", findings: ["export.ts: add a test"] } }));
    const { reviewer, runs } = await reviewerWith(engine);

    const outcome = await reviewer.review({ item, diff: "diff --git a/x b/x" });

    expect(outcome).toMatchObject({ ok: true, value: { verdict: "changes_requested", findings: ["export.ts: add a test"] } });
    expect(engine.requests[0]).toMatchObject({ access: "read", cwd: "/tmp/base", model: "gpt-x" });
    expect(engine.requests[0]?.prompt).toContain("Archived items are not exported");
    expect(engine.requests[0]?.prompt).toContain("diff --git a/x b/x");
    expect(runs.list()[0]).toMatchObject({ role: "code_reviewer", orderId: "WO-0001" });
  });

  it("refuses a verdict that asks for changes without saying which", async () => {
    const { reviewer } = await reviewerWith(new FakeEngine(() => ({ structured: { verdict: "changes_requested", summary: "Not good.", findings: [] } })));

    expect(await reviewer.review({ item, diff: "" })).toMatchObject({ ok: false, error: expect.stringContaining("at least one finding") });
  });

  it("reports an engine failure", async () => {
    const { reviewer } = await reviewerWith(new FakeEngine(() => ({ kind: "failed", message: "rate limited" })));

    expect(await reviewer.review({ item, diff: "" })).toMatchObject({ ok: false, error: "rate limited" });
  });
});
