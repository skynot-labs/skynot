import { describe, expect, it } from "vitest";
import { createOrderDesk } from "../../src/app/order-desk";
import { err, fixedClock, ok, type Result } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { ChatProjection, ManagerService, type ModelRunner } from "../../src/manager";
import { OrderService, OrdersProjection } from "../../src/orders";
import { validSpec } from "../orders/fixtures";

async function createManager(script: Array<Result<unknown, string>>) {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-09T12:00:00.000Z")));
  const orders = new OrdersProjection();
  const chat = new ChatProjection();
  await attachProjection(log, orders);
  await attachProjection(log, chat);
  const runner: ModelRunner = {
    async ask() {
      const next = script.shift();
      if (!next) throw new Error("the script ran out of answers");
      return next;
    },
  };
  const manager = new ManagerService({ log, chat, runner, desk: createOrderDesk(new OrderService(log, orders), orders) });
  return { manager, chat, orders };
}

const answer = (extra: Record<string, unknown>) => ok({ message: "Here it is.", question: null, options: [], orders: [], consult: [], team: null, ...extra });

describe("a ticket the Manager could not turn into an order", () => {
  it("waits in the inbox when the engine cannot be reached (what the code promises)", async () => {
    const { manager, chat } = await createManager([err("the run was stopped")]);

    await manager.handleTicket({ number: 42, title: "Add an RSS feed", body: "" });

    expect(chat.openDecisions()).toMatchObject([{ ticket: 42 }]);
  });

  it("waits in the inbox when the order it wrote is refused by the order desk", async () => {
    const { manager, chat, orders } = await createManager([answer({ orders: [validSpec({ dependsOn: ["WO-0099"] })] })]);

    await manager.handleTicket({ number: 42, title: "Add an RSS feed", body: "" });

    expect(orders.list()).toEqual([]);
    expect(chat.messages().at(-1)?.text).toContain("I could not file that order");
    expect(chat.openDecisions()).toMatchObject([{ ticket: 42 }]);
  });

  it("still waits in the inbox when the turn that follows the director's answer fails", async () => {
    const { manager, chat, orders } = await createManager([answer({ question: "Which pages get the feed?" }), err("claude timed out")]);
    await manager.handleTicket({ number: 42, title: "Add an RSS feed", body: "" });
    const [doubt] = chat.openDecisions();

    await manager.answerDecision(doubt!.id, "Only the blog");

    expect(orders.list()).toEqual([]);
    expect(chat.openDecisions()).toMatchObject([{ ticket: 42 }]);
  });
});
