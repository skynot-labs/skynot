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
