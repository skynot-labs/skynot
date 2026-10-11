import { describe, expect, it } from "vitest";
import type { Order } from "../src/contracts";
import { orderActions } from "../src/ui/order-actions";

const order = (overrides: Partial<Order>) => ({ status: "on_bench", working: false, blocked: null, question: null, ...overrides }) as Order;
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
