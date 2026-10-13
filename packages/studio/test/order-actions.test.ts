import { describe, expect, it } from "vitest";
import type { Order } from "../src/contracts";
import { orderActions, unblocking } from "../src/ui/order-actions";

const order = (overrides: Partial<Order>) => ({ id: "WO-0001", status: "on_bench", working: false, blocked: null, question: null, protectedPaths: [], ...overrides }) as Order;
const offered = (overrides: Partial<Order>, simulated = false) =>
  Object.entries(orderActions(order(overrides), simulated))
    .filter(([, allowed]) => allowed)
    .map(([name]) => name);

describe("what an order's detail offers", () => {
  it("offers only to stop an order that is being worked, whatever its status", () => {
    expect(offered({ status: "on_bench", working: true })).toEqual(["stop"]);
    expect(offered({ status: "in_review", working: true }, true)).toEqual(["stop"]);
  });

  it("does not offer to stop an order nobody is working on", () => {
    expect(offered({ status: "on_bench", question: "Which color?" })).not.toContain("stop");
    expect(offered({ status: "on_bench", blocked: "the checks failed" })).not.toContain("stop");
  });

  it("lets an order on the bench be discarded only once it waits on the director", () => {
    expect(offered({ status: "on_bench", question: "Which color?" })).toEqual(["discard", "reassign"]);
    expect(offered({ status: "on_bench", blocked: "the checks failed" })).toEqual(["discard", "reassign"]);
    expect(offered({ status: "on_bench" })).toEqual(["reassign"]);
  });

  it("lets an order in review be discarded once it is blocked or asks, and not while its pull request just waits", () => {
    expect(offered({ status: "in_review", blocked: "the pull request was closed without merging" })).toEqual(["discard", "reassign"]);
    expect(offered({ status: "in_review", question: "Which color?" })).toEqual(["discard", "reassign"]);
    expect(offered({ status: "in_review" })).not.toContain("discard");
  });

  it("offers the signature only before it is given, and nothing once the order is closed", () => {
    expect(offered({ status: "awaiting_signature" })).toEqual(["discard", "sign"]);
    expect(offered({ status: "signed" })).toEqual(["discard", "reassign"]);
    expect(offered({ status: "delivered" })).toEqual([]);
    expect(offered({ status: "discarded" })).toEqual([]);
  });

  it("offers the simulated merge only in a simulated shop", () => {
    expect(offered({ status: "in_review" }, true)).toEqual(["reassign", "merge"]);
    expect(offered({ status: "in_review" })).toEqual(["reassign"]);
  });
});

describe("what gets a blocked order moving", () => {
  const way = (overrides: Partial<Order>) => unblocking(order({ blocked: "the checks failed", ...overrides }))?.command.name ?? null;
  const onPaths = { blocked: "it touches .github/workflows/pages.yml, which is protected", protectedPaths: [".github/workflows/pages.yml"] };

  it("retries an order whose run failed before it reached review", () => {
    expect(way({ status: "on_bench" })).toBe("retry-order");
    expect(way({ status: "signed" })).toBe("retry-order");
  });

  it("asks for the approval, never a retry, when the block is a protected path", () => {
    expect(way(onPaths)).toBe("approve-protected-paths");
    expect(way({ ...onPaths, status: "in_review" })).toBe("approve-protected-paths");
    expect(unblocking(order(onPaths))?.label).toBe("Approve .github/workflows/pages.yml");
  });

  it("offers nothing for an order in review that only a follow-up can move, one being worked, or one that is not blocked", () => {
    expect(way({ status: "in_review" })).toBeNull();
    expect(way({ ...onPaths, working: true })).toBeNull();
    expect(way({ blocked: null })).toBeNull();
  });
});
