import { describe, expect, it } from "vitest";
import { CARD_WIDTH, evolve, propose, renderCard, type OrderEvent, type OrderId, type WorkOrder } from "../../src/orders";
import { validSpec } from "./fixtures";

const id = "WO-0042" as OrderId;

function orderWith(events: OrderEvent[], spec = validSpec()): WorkOrder {
  let order = evolve(null, propose(id, spec), "2026-10-09T12:00:00.000Z");
  for (const event of events) order = evolve(order, event, "2026-10-09T12:00:00.000Z");
  if (!order) throw new Error("no order");
  return order;
}

describe("work order card", () => {
  it("renders a pending order with its criteria as checkboxes", () => {
    expect(renderCard(orderWith([]))).toBe(
      [
        "WO-0042  Export the inventory to CSV",
        "status   ? needs your signature",
        "[ ] GET /items.csv returns every active item",
        "[ ] Archived items are not exported",
        "next     director signature",
      ].join("\n"),
    );
  });

  it("shows only three criteria and says how many more are in the issue", () => {
    const criterion = (statement: string) => ({ statement, verification: { kind: "test" as const, detail: "a test" } });
    const spec = validSpec({
      acceptanceCriteria: ["First one", "Second one", "Third one", "Fourth one", "Fifth one"].map(criterion),
    });

    const card = renderCard(orderWith([], spec));

    expect(card).toContain("Third one");
    expect(card).not.toContain("Fourth one");
    expect(card).toContain("+2 more in the issue");
  });

  it("wraps a long title under the id instead of cutting it", () => {
    const title = "Add pagination and sorting to the inventory table on the items page";
    const card = renderCard(orderWith([], validSpec({ title })));

    expect(card.split("\n").slice(0, 2).join(" ").replace(/\s+/g, " ")).toContain(title);
  });

  it("never exceeds the card width", () => {
    const long = "word ".repeat(40).trim();
    const spec = validSpec({
      title: long.slice(0, 60),
      acceptanceCriteria: [{ statement: long.slice(0, 140), verification: { kind: "test", detail: "a test" } }],
    });

    const widest = Math.max(...renderCard(orderWith([], spec)).split("\n").map((line) => line.length));

    expect(widest).toBeLessThanOrEqual(CARD_WIDTH);
  });

  it("uses a mark per state and asks for minutes once delivered", () => {
    const orderId = { orderId: id };
    const signed: OrderEvent[] = [{ type: "orders.signed", payload: orderId }];
    const onBench = [...signed, { type: "orders.work_started" as const, payload: orderId }];
    const inReview = [...onBench, { type: "orders.pull_request_opened" as const, payload: { ...orderId, pullRequest: 9 } }];
    const delivered = [...inReview, { type: "orders.delivered" as const, payload: orderId }];
    const withMinutes = [...delivered, { type: "orders.minutes_recorded" as const, payload: { ...orderId, bucket: "lt5" as const } }];

    expect(renderCard(orderWith(onBench))).toContain("status   ⧗ on the bench");
    expect(renderCard(orderWith(inReview))).toContain("next     director reviews and merges");
    expect(renderCard(orderWith(delivered))).toContain("status   ✓ delivered");
    expect(renderCard(orderWith(delivered))).toContain("next     director reports minutes");
    expect(renderCard(orderWith(withMinutes))).toContain("next     none");
  });
});
