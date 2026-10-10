import { describe, expect, it } from "vitest";
import { blockersOf, evolve, propose, type OrderStatus, type WorkOrder, type WorkOrderSpec } from "../../src/orders";
import { validSpec } from "./fixtures";

function order(number: number, status: OrderStatus, spec: Partial<WorkOrderSpec> = {}): WorkOrder {
  const id = `WO-${String(number).padStart(4, "0")}` as WorkOrder["id"];
  const proposed = evolve(null, propose(id, validSpec(spec)), "2026-10-10T10:00:00.000Z")!;
  return { ...proposed, status };
}

describe("blockersOf", () => {
  it("waits for an earlier open order that touches the same file", () => {
    const earlier = order(1, "in_review");
    expect(blockersOf(order(2, "signed"), [earlier, order(2, "signed")])).toEqual(["WO-0001"]);
  });

  it("treats a folder and a file inside it as the same place", () => {
    const earlier = order(1, "on_bench", { likelyFiles: ["src/items/"] });
    expect(blockersOf(order(2, "signed"), [earlier])).toEqual(["WO-0001"]);
  });

  it("does not confuse a folder with a file that only starts with its name", () => {
    const earlier = order(1, "on_bench", { likelyFiles: ["src/item"] });
    expect(blockersOf(order(2, "signed"), [earlier])).toEqual([]);
  });

  it("ignores delivered, discarded and later orders, and orders that name no files", () => {
    const all = [order(1, "delivered"), order(3, "signed"), order(4, "signed", { likelyFiles: [] }), order(5, "discarded")];
    expect(blockersOf(order(2, "signed"), all)).toEqual([]);
    expect(blockersOf(order(6, "signed", { likelyFiles: [] }), [order(1, "in_review")])).toEqual([]);
  });

  it("waits for what it declares until that is delivered or discarded", () => {
    const mine = order(3, "signed", { likelyFiles: ["src/x.ts"], dependsOn: ["WO-0001", "WO-0002"] });
    const withStates = (first: OrderStatus, second: OrderStatus) => [order(1, first, { likelyFiles: ["a"] }), order(2, second, { likelyFiles: ["b"] })];

    expect(blockersOf(mine, withStates("in_review", "signed"))).toEqual(["WO-0001", "WO-0002"]);
    expect(blockersOf(mine, withStates("delivered", "discarded"))).toEqual([]);
  });
});
