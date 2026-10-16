import { describe, expect, it } from "vitest";
import { ReviewNotice } from "../../src/app/review-notice";
import { fixedClock } from "../../src/kernel";
import { EventLog, InMemoryEventStore } from "../../src/kernel/events";

async function noticeFor(local: boolean, round = 2): Promise<string[]> {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-16T12:00:00.000Z")));
  const said: string[] = [];
  new ReviewNotice({ log, say: async (text) => void said.push(text), mergesHere: () => local }).start();
  await log.record([{ type: "delivery.review_completed", payload: { orderId: "WO-0001", round, verdict: "changes_requested", summary: "node_modules is committed.", findings: [] } }]);
  await new Promise((resolve) => setImmediate(resolve));
  return said;
}

describe("the notice of a review that still asks for changes", () => {
  it("sends the director to the order's card for a project on this machine, and to GitHub for the others", async () => {
    expect(await noticeFor(true)).toEqual(["The reviewer still asks for changes on WO-0001 after 2 rounds: node_modules is committed. Send a follow-up from its card, or merge it anyway from the same card."]);
    expect((await noticeFor(false))[0]).toContain("or merge it anyway on GitHub.");
  });

  it("says nothing after the first round, which the shop follows up on its own", async () => {
    expect(await noticeFor(true, 1)).toEqual([]);
  });
});
