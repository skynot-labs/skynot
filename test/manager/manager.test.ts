import { describe, expect, it } from "vitest";
import { createManagerRunner } from "../../src/app/model-runner";
import { createOrderDesk } from "../../src/app/order-desk";
import { FakeEngine, RunScheduler } from "../../src/execution";
import { err, fixedClock, ok, type Result } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { ChatProjection, ManagerService, createAnswerSchema, type ModelRunner } from "../../src/manager";
import { OrderService, OrdersProjection, WorkOrderSpecSchema } from "../../src/orders";
import { validSpec } from "../orders/fixtures";

type Script = Array<Result<unknown, string> | ((prompt: string) => Result<unknown, string>)>;

function scriptedRunner(script: Script) {
  const prompts: string[] = [];
  const runner: ModelRunner = {
    async ask({ prompt }) {
      prompts.push(prompt);
      const next = script.shift();
      if (!next) throw new Error("the script ran out of answers");
      return typeof next === "function" ? next(prompt) : next;
    },
  };
  return { runner, prompts };
}

const say = (message: string, extra: Record<string, unknown> = {}) =>
  ok({ message, question: null, options: [], order: null, ...extra });

async function createManager(script: Script) {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-09T12:00:00.000Z")));
  const orders = new OrdersProjection();
  const chat = new ChatProjection();
  await attachProjection(log, orders);
  await attachProjection(log, chat);
  const orderService = new OrderService(log, orders);
  const { runner, prompts } = scriptedRunner(script);
  const manager = new ManagerService({ log, chat, runner, desk: createOrderDesk(orderService, orders) });
  return { manager, chat, orders, orderService, prompts, log };
}

describe("answer schema", () => {
  const schema = createAnswerSchema(WorkOrderSpecSchema);
  const reply = { message: "Done.", question: null, options: [], order: null };

  it("accepts a plain reply, a question with options, and an order", () => {
    expect(schema.safeParse(reply).success).toBe(true);
    expect(schema.safeParse({ ...reply, question: "Include archived?", options: ["Yes", "No"] }).success).toBe(true);
    expect(schema.safeParse({ ...reply, order: validSpec() }).success).toBe(true);
  });

  it("rejects an order together with a question", () => {
    expect(schema.safeParse({ ...reply, question: "Which one?", order: validSpec() }).success).toBe(false);
  });

  it("rejects options without a question and more than three options", () => {
    expect(schema.safeParse({ ...reply, options: ["Yes"] }).success).toBe(false);
    expect(schema.safeParse({ ...reply, question: "Which?", options: ["a", "b", "c", "d"] }).success).toBe(false);
  });

  it("rejects an order whose spec is invalid", () => {
    expect(schema.safeParse({ ...reply, order: { ...validSpec(), acceptanceCriteria: [] } }).success).toBe(false);
  });
});

describe("manager", () => {
  it("records the director's message and the Manager's reply in the chat", async () => {
    const { manager, chat } = await createManager([say("Nothing on the bench.")]);

    await manager.handleMessage("How are we doing?");

    expect(chat.messages().map((message) => [message.author, message.text])).toEqual([
      ["director", "How are we doing?"],
      ["manager", "Nothing on the bench."],
    ]);
  });

  it("turns an idea into a work order and shows its card in the reply", async () => {
    const { manager, chat, orders } = await createManager([say("Filed.", { order: validSpec() })]);

    await manager.handleMessage("Export the inventory to CSV");

    const reply = chat.messages().at(-1)!;
    expect(orders.list()).toHaveLength(1);
    expect(reply.orderId).toBe("WO-0001");
    expect(reply.text).toContain("Filed.");
    expect(reply.text).toContain("WO-0001  Export the inventory to CSV");
    expect(reply.text).toContain("status   ? needs your signature");
  });

  it("asks the director a question and keeps it open until answered", async () => {
    const { manager, chat, orders } = await createManager([
      say("One thing first.", { question: "Include archived items?", options: ["Yes", "Only active"] }),
    ]);

    await manager.handleMessage("Export items to CSV");

    expect(chat.openDecisions()).toMatchObject([{ question: "Include archived items?", options: ["Yes", "Only active"] }]);
    expect(chat.messages().at(-1)?.decisionId).toBe(chat.openDecisions()[0]?.id);
    expect(orders.list()).toEqual([]);
  });

  it("closes the question when answered and gives the answer to the Manager on the next turn", async () => {
    const { manager, chat, prompts } = await createManager([
      say("One thing first.", { question: "Include archived items?", options: ["Yes", "Only active"] }),
      say("Filed.", { order: validSpec() }),
    ]);
    await manager.handleMessage("Export items to CSV");
    const [decision] = chat.openDecisions();

    expect(await manager.answerDecision(decision!.id, "Only active")).toEqual({ ok: true, value: undefined });

    expect(chat.openDecisions()).toEqual([]);
    expect(prompts[1]).toContain('Answer to "Include archived items?": Only active');
    expect(chat.messages().at(-1)?.orderId).toBe("WO-0001");
  });

  it("refuses to answer an unknown question or answer the same one twice", async () => {
    const { manager, chat } = await createManager([say("Which?", { question: "Which one?", options: [] }), say("Ok.")]);
    await manager.handleMessage("do it");
    const id = chat.openDecisions()[0]!.id;
    await manager.answerDecision(id, "the first");

    expect(await manager.answerDecision("dec_missing", "x")).toMatchObject({ ok: false });
    expect(await manager.answerDecision(id, "again")).toMatchObject({ ok: false, error: expect.stringContaining("already") });
  });

  it("sends the rejection reasons back to the model and accepts the corrected answer", async () => {
    const { manager, chat, prompts, orders } = await createManager([
      say("Filed.", { order: { ...validSpec(), acceptanceCriteria: [] } }),
      say("Filed.", { order: validSpec() }),
    ]);

    await manager.handleMessage("Export items to CSV");

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Your previous answer was rejected");
    expect(prompts[1]).toContain("order.acceptanceCriteria");
    expect(orders.list()).toHaveLength(1);
    expect(chat.messages().at(-1)?.orderId).toBe("WO-0001");
  });

  it("stops after three invalid answers and tells the director, without inventing an order", async () => {
    const invalid = ok({ nonsense: true });
    const { manager, chat, prompts, orders } = await createManager([invalid, invalid, invalid]);

    await manager.handleMessage("Export items to CSV");

    expect(prompts).toHaveLength(3);
    expect(orders.list()).toEqual([]);
    expect(chat.messages().at(-1)?.text).toContain("could not produce a valid answer");
  });

  it("reports an engine failure in the chat instead of retrying", async () => {
    const { manager, chat, prompts } = await createManager([err("claude timed out")]);

    await manager.handleMessage("hello");

    expect(prompts).toHaveLength(1);
    expect(chat.messages().at(-1)?.text).toContain("claude timed out");
  });

  it("shows the Manager the current orders, open questions and recent conversation", async () => {
    const { manager, orderService, prompts } = await createManager([
      say("Which?", { question: "Which database?", options: [] }),
      say("Ok."),
    ]);
    await orderService.propose(validSpec({ title: "Existing order" }));
    await manager.handleMessage("first message");

    await manager.handleMessage("second message");

    expect(prompts[1]).toContain("- WO-0001 [awaiting_signature] Existing order");
    expect(prompts[1]).toContain("- Which database?");
    expect(prompts[1]).toContain("director: first message");
    expect(prompts[1]).toContain("manager: Which?");
    expect(prompts[1]).toContain("second message");
  });

  it("handles messages sent at the same time one after the other", async () => {
    const { manager, chat } = await createManager([say("Reply one."), say("Reply two.")]);

    await Promise.all([manager.handleMessage("one"), manager.handleMessage("two")]);

    expect(chat.messages().map((message) => message.text)).toEqual(["one", "Reply one.", "two", "Reply two."]);
  });
});

describe("manager runner", () => {
  const request = { message: "Hi.", question: null, options: [], order: null };

  async function ask(engine: FakeEngine) {
    const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date()));
    const runner = createManagerRunner(new RunScheduler({ claude: engine }, log, 1), {
      engine: "claude",
      cwd: "/work",
      timeoutMs: 1000,
      maxUsd: 1,
    });
    const schema = createAnswerSchema(WorkOrderSpecSchema);
    return runner.ask({ system: "sys", prompt: "prompt", schema });
  }

  it("runs the Manager read-only on the project directory with a JSON schema", async () => {
    const engine = new FakeEngine(() => ({ structured: request }));

    expect(await ask(engine)).toEqual({ ok: true, value: request });
    expect(engine.requests[0]).toMatchObject({ access: "read", cwd: "/work", system: "sys", maxUsd: 1 });
    expect(engine.requests[0]?.schema).toMatchObject({ type: "object" });
  });

  it("falls back to parsing the text when the engine gives no structured output", async () => {
    expect(await ask(new FakeEngine(() => ({ text: JSON.stringify(request) })))).toEqual({ ok: true, value: request });
  });

  it("passes an engine failure up as a message", async () => {
    expect(await ask(new FakeEngine(() => ({ kind: "timeout", message: "codex timed out" })))).toEqual({
      ok: false,
      error: "codex timed out",
    });
  });
});
