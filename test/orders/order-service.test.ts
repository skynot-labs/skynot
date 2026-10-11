import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore, JsonlEventStore, type EventStore } from "../../src/kernel/events";
import { OrderService, OrdersProjection, type WorkOrder } from "../../src/orders";
import { validSpec } from "./fixtures";

const clock = fixedClock(new Date("2026-10-09T12:00:00.000Z"));

async function createShop(store: EventStore = new InMemoryEventStore()) {
  const log = new EventLog(store, clock);
  const orders = new OrdersProjection();
  await attachProjection(log, orders);
  return { log, orders, service: new OrderService(log, orders) };
}

function expectOk(result: { ok: boolean } & Record<string, unknown>): WorkOrder {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value as WorkOrder;
}

describe("order service", () => {
  it("numbers orders sequentially, even when proposed at the same time", async () => {
    const { service } = await createShop();

    const results = await Promise.all([service.propose(validSpec()), service.propose(validSpec()), service.propose(validSpec())]);

    expect(results.map((result) => expectOk(result).id)).toEqual(["WO-0001", "WO-0002", "WO-0003"]);
  });

  it("rejects an invalid spec without recording anything", async () => {
    const { service, log } = await createShop();

    const result = await service.propose({ ...validSpec(), acceptanceCriteria: [] });

    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_spec" } });
    expect(await log.readAfter(0)).toEqual([]);
  });

  it("carries an order from proposal to delivery with the minutes recorded", async () => {
    const { service } = await createShop();
    const { id } = expectOk(await service.propose(validSpec()));

    await service.sign(id);
    await service.startWork(id);
    await service.openPullRequest(id, 17);
    await service.deliver(id);
    const done = expectOk(await service.recordMinutes(id, "5-15"));

    expect(done).toMatchObject({
      status: "delivered",
      pullRequest: 17,
      minutes: "5-15",
      signedAt: "2026-10-09T12:00:00.000Z",
      deliveredAt: "2026-10-09T12:00:00.000Z",
    });
  });

  it("refuses steps out of order and leaves the order untouched", async () => {
    const { service, orders, log } = await createShop();
    const { id } = expectOk(await service.propose(validSpec()));
    const before = (await log.readAfter(0)).length;

    expect(await service.deliver(id)).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
    expect(await service.startWork(id)).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
    expect(orders.get(id)?.status).toBe("awaiting_signature");
    expect(await log.readAfter(0)).toHaveLength(before);
  });

  it("refuses to sign twice, so a double click cannot start two runs", async () => {
    const { service } = await createShop();
    const { id } = expectOk(await service.propose(validSpec()));

    const [first, second] = await Promise.all([service.sign(id), service.sign(id)]);

    expect([first.ok, second.ok].sort()).toEqual([false, true]);
  });

  it("does not allow discarding an order a worker already started", async () => {
    const { service } = await createShop();
    const { id } = expectOk(await service.propose(validSpec()));
    await service.sign(id);
    await service.startWork(id);

    expect(await service.discard(id)).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
  });

  it("records minutes only once, and only after delivery", async () => {
    const { service } = await createShop();
    const { id } = expectOk(await service.propose(validSpec()));

    expect(await service.recordMinutes(id, "lt5")).toMatchObject({ ok: false });

    await service.sign(id);
    await service.startWork(id);
    await service.openPullRequest(id, 3);
    await service.deliver(id);
    expectOk(await service.recordMinutes(id, "lt5"));

    expect(await service.recordMinutes(id, "gt30")).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
  });

  it("reports an unknown order", async () => {
    const { service } = await createShop();
    expect(await service.sign("WO-0099")).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });
});

describe("a plan of several orders", () => {
  const plan = (...titles: string[]) => titles.map((title) => validSpec({ title }));
  const expectPlan = (result: { ok: boolean } & Record<string, unknown>): WorkOrder[] => {
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
    return result.value as WorkOrder[];
  };

  it("files its orders together, in sequence, each knowing the plan it belongs to", async () => {
    const { service } = await createShop();
    await service.propose(validSpec());

    const filed = expectPlan(await service.proposePlan(plan("Store the items", "Export them", "Document the export")));

    expect(filed.map((order) => [order.id, order.plan, order.status])).toEqual([
      ["WO-0002", "WO-0002", "awaiting_signature"],
      ["WO-0003", "WO-0002", "awaiting_signature"],
      ["WO-0004", "WO-0002", "awaiting_signature"],
    ]);
  });

  it("turns the positions an order needs into the ids of those orders", async () => {
    const { service } = await createShop();
    const [first] = expectPlan(await service.proposePlan([validSpec()]));

    const filed = expectPlan(await service.proposePlan([validSpec(), validSpec({ needs: [1], dependsOn: [first!.id] }), validSpec({ needs: [1, 2] })]));

    expect(filed.map((order) => order.spec.dependsOn)).toEqual([undefined, ["WO-0001", "WO-0002"], ["WO-0002", "WO-0003"]]);
    expect(filed.every((order) => !("needs" in order.spec))).toBe(true);
  });

  it("files nothing when one order is invalid, needs a later one, or the plan is empty or too long", async () => {
    const { service, orders } = await createShop();

    expect(await service.proposePlan([validSpec(), { ...validSpec(), acceptanceCriteria: [] }])).toMatchObject({ ok: false, error: { kind: "invalid_spec", message: expect.stringContaining("order 2: acceptanceCriteria") } });
    expect(await service.proposePlan([validSpec({ needs: [2] }), validSpec()])).toMatchObject({ ok: false, error: { message: expect.stringContaining("order 1: needs can only name earlier orders") } });
    expect(await service.proposePlan([])).toMatchObject({ ok: false, error: { kind: "invalid_spec" } });
    expect(await service.proposePlan(plan("1st", "2nd", "3rd", "4th", "5th", "6th"))).toMatchObject({ ok: false, error: { kind: "invalid_spec" } });
    expect(orders.list()).toEqual([]);
  });

  it("is signed once, and a second signature finds nothing left to sign", async () => {
    const { service, orders } = await createShop();
    const [first] = expectPlan(await service.proposePlan(plan("Store the items", "Export them")));
    await service.discard("WO-0002");

    const signed = expectPlan(await service.signPlan(first!.id));

    expect(signed.map((order) => [order.id, order.status])).toEqual([["WO-0001", "signed"]]);
    expect(orders.get("WO-0002")?.status).toBe("discarded");
    expect(await service.signPlan(first!.id)).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
    expect(await service.signPlan("WO-0099")).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });

  it("is replaced as a whole while unsigned: the old orders are withdrawn and the new ones filed", async () => {
    const { service, orders } = await createShop();
    await service.proposePlan(plan("Store the items", "Export them"));

    const revised = expectPlan(await service.proposePlan(plan("Store and export the items"), { replaces: "WO-0001" }));

    expect(revised.map((order) => [order.id, order.plan])).toEqual([["WO-0003", "WO-0003"]]);
    expect(orders.list().map((order) => order.status)).toEqual(["discarded", "discarded", "awaiting_signature"]);
  });

  it("cannot be replaced once signed, nor by a plan that depends on what it withdraws, and nothing changes", async () => {
    const { service, orders } = await createShop();
    await service.proposePlan(plan("Store the items", "Export them"));
    await service.proposePlan(plan("Another idea"));

    expect(await service.proposePlan([validSpec({ dependsOn: ["WO-0001"] })], { replaces: "WO-0001" })).toMatchObject({ ok: false, error: { message: expect.stringContaining("no such order") } });
    await service.signPlan("WO-0001");
    expect(await service.proposePlan(plan("Changed my mind"), { replaces: "WO-0001" })).toMatchObject({ ok: false, error: { kind: "invalid_transition", message: expect.stringContaining("already signed") } });
    expect(await service.proposePlan(plan("Changed my mind"), { replaces: "WO-0042" })).toMatchObject({ ok: false, error: { message: expect.stringContaining("no plan WO-0042") } });
    expect(orders.list().map((order) => order.status)).toEqual(["signed", "signed", "awaiting_signature"]);
  });

  it("reads an order filed before plans and summaries existed as its own plan, summarized by its objective", async () => {
    const { log, orders } = await createShop();
    const { summary: _summary, approach: _approach, ...old } = validSpec();

    await log.record([{ type: "orders.proposed", payload: { orderId: "WO-0001", spec: old } }]);

    expect(orders.get("WO-0001")).toMatchObject({ plan: "WO-0001", spec: { summary: old.objective, approach: [] } });
  });
});

describe("orders rebuilt from the log", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "skynot-orders-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("restores every order after a restart and keeps numbering from where it stopped", async () => {
    const file = path.join(dir, "events.jsonl");
    const first = await createShop(new JsonlEventStore(file));
    const a = expectOk(await first.service.propose(validSpec()));
    await first.service.sign(a.id);
    expectOk(await first.service.propose(validSpec({ title: "Second order" })));

    const restarted = await createShop(new JsonlEventStore(file));

    expect(restarted.orders.list().map((order) => [order.id, order.status])).toEqual([
      ["WO-0001", "signed"],
      ["WO-0002", "awaiting_signature"],
    ]);
    expect(expectOk(await restarted.service.propose(validSpec())).id).toBe("WO-0003");
  });
});
