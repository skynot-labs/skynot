import { describe, expect, it, vi } from "vitest";
import { BlockedNotice } from "../../src/app/blocked-notice";
import { fixedClock } from "../../src/kernel";
import { EventLog, InMemoryEventStore } from "../../src/kernel/events";
import type { WorkOrder } from "../../src/orders";

function openNotice(status: WorkOrder["status"] | undefined, protectedPaths: string[] = []) {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-11T12:00:00.000Z")));
  const said: Array<[string, string]> = [];
  const failures: unknown[] = [];
  const notice = new BlockedNotice({
    log,
    say: async (text, orderId) => void said.push([orderId, text]),
    findOrder: () => (status ? ({ status } as WorkOrder) : undefined),
    protectedPathsOf: () => protectedPaths,
    onError: (error) => failures.push(error),
  });
  notice.start();
  const block = (reason: string) => log.record([{ type: "delivery.work_blocked", payload: { orderId: "WO-0003", reason } }]);
  return { said, failures, block, log };
}

describe("blocked notice", () => {
  it.each([
    ["on_bench", [], "Retry or discard it from its card."],
    ["signed", [], "Retry or discard it from its card."],
    ["in_review", [], "Send a follow-up from its card, or close the pull request."],
    ["on_bench", [".github/ci.yml"], "Approve those paths on its card, or make the change yourself on GitHub."],
  ] as const)("tells the director in the chat what to do for a %s order with %j", async (status, paths, hint) => {
    const { said, block } = openNotice(status, [...paths]);

    await block("the worker changed nothing");

    await vi.waitFor(() => expect(said).toEqual([["WO-0003", `WO-0003 is blocked: the worker changed nothing. ${hint}`]]));
  });

  it("says nothing for events that are not blocks", async () => {
    const { said, log } = openNotice("on_bench");

    await log.record([{ type: "delivery.work_retried", payload: { orderId: "WO-0003" } }]);

    expect(said).toEqual([]);
  });

  it("reports a failure to say it instead of losing it", async () => {
    const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-11T12:00:00.000Z")));
    const failures: unknown[] = [];
    new BlockedNotice({ log, say: async () => Promise.reject(new Error("chat down")), findOrder: () => undefined, protectedPathsOf: () => [], onError: (error) => failures.push(error) }).start();

    await log.record([{ type: "delivery.work_blocked", payload: { orderId: "WO-0003", reason: "x" } }]);

    await vi.waitFor(() => expect(failures).toHaveLength(1));
  });
});
