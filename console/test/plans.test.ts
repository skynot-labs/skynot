import { describe, expect, it } from "vitest";
import { planOf, plansToSign } from "../src/application/plans";
import type { Order } from "../src/contracts";

const order = (id: string, plan: string, status: Order["status"] = "awaiting_signature") => ({ id, plan, status }) as Order;
const ids = (plans: Order[][]) => plans.map((plan) => plan.map((entry) => entry.id));

describe("plans at the console", () => {
  const orders = [order("WO-0001", "WO-0001", "delivered"), order("WO-0002", "WO-0002"), order("WO-0003", "WO-0002"), order("WO-0004", "WO-0004"), order("WO-0005", "WO-0002", "discarded")];

  it("groups what waits for a signature by plan, in the sequence the orders were filed", () => {
    expect(ids(plansToSign(orders))).toEqual([["WO-0002", "WO-0003"], ["WO-0004"]]);
  });

  it("offers nothing to sign of a plan whose orders are all signed or withdrawn", () => {
    expect(plansToSign([order("WO-0001", "WO-0001", "signed"), order("WO-0002", "WO-0001", "discarded")])).toEqual([]);
  });

  it("shows a plan whole, withdrawn orders included, so the chat keeps what was proposed", () => {
    expect(planOf(orders, orders[2]!).map((entry) => entry.id)).toEqual(["WO-0002", "WO-0003", "WO-0005"]);
  });
});
