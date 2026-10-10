import { describe, expect, it } from "vitest";
import { createManagerRunner } from "../../src/app/model-runner";
import { createOrderDesk } from "../../src/app/order-desk";
import { FakeEngine, RunScheduler } from "../../src/execution";
import { err, fixedClock, ok, type Result } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { ChatProjection, ManagerService, createAnswerSchema, type AdvisorBench, type AdvisorReply, type AdvisorRequest, type ModelRunner } from "../../src/manager";
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
  ok({ message, question: null, options: [], order: null, consult: [], ...extra });

async function createManager(script: Script, advisors?: AdvisorBench) {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-09T12:00:00.000Z")));
  const orders = new OrdersProjection();
  const chat = new ChatProjection();
  await attachProjection(log, orders);
  await attachProjection(log, chat);
  const orderService = new OrderService(log, orders);
  const { runner, prompts } = scriptedRunner(script);
  const manager = new ManagerService({ log, chat, runner, desk: createOrderDesk(orderService, orders), ...(advisors && { advisors }) });
  return { manager, chat, orders, orderService, prompts, log };
}

describe("answer schema", () => {
  const schema = createAnswerSchema(WorkOrderSpecSchema);
  const reply = { message: "Done.", question: null, options: [], order: null, consult: [] };

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
      cwd: async () => "/work",
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

  it("asks for the project directory on every call, so it always reads a fresh copy", async () => {
    const engine = new FakeEngine(() => ({ structured: request }));
    const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date()));
    let calls = 0;
    const runner = createManagerRunner(new RunScheduler({ claude: engine }, log, 1), {
      engine: "claude",
      cwd: async () => `/copy-${++calls}`,
      timeoutMs: 1000,
    });
    const schema = createAnswerSchema(WorkOrderSpecSchema);

    await runner.ask({ system: "s", prompt: "p", schema });
    await runner.ask({ system: "s", prompt: "p", schema });

    expect(engine.requests.map((entry) => entry.cwd)).toEqual(["/copy-1", "/copy-2"]);
  });

  it("reports a repository that cannot be read without running the model", async () => {
    const engine = new FakeEngine(() => ({ structured: request }));
    const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date()));
    const runner = createManagerRunner(new RunScheduler({ claude: engine }, log, 1), {
      engine: "claude",
      cwd: async () => {
        throw new Error("gh: not logged in");
      },
      timeoutMs: 1000,
    });

    const outcome = await runner.ask({ system: "s", prompt: "p", schema: createAnswerSchema(WorkOrderSpecSchema) });

    expect(outcome).toEqual({ ok: false, error: "could not read the repository: gh: not logged in" });
    expect(engine.requests).toEqual([]);
  });

  it("passes an engine failure up as a message", async () => {
    expect(await ask(new FakeEngine(() => ({ kind: "timeout", message: "codex timed out" })))).toEqual({
      ok: false,
      error: "codex timed out",
    });
  });
});

describe("rejected answers", () => {
  const rejections = async (log: Awaited<ReturnType<typeof createManager>>["log"]) =>
    (await log.readAfter(0)).filter((event) => event.type === "manager.answer_rejected").map((event) => event.payload);

  it("records why each rejected answer was rejected, with its attempt number", async () => {
    const { manager, chat, log } = await createManager([
      say("Pick one.", { question: "Which?", options: ["a very long option that goes beyond the limit of forty characters"] }),
      say("Still wrong.", { options: ["orphan"] }),
      say("Fine."),
    ]);

    await manager.handleMessage("Do something");

    expect(chat.messages().at(-1)?.text).toBe("Fine.");
    expect(await rejections(log)).toEqual([
      { attempt: 1, issues: expect.stringContaining("options.0: Too big") },
      { attempt: 2, issues: expect.stringContaining("options: options are only allowed together with a question") },
    ]);
  });

  it("records nothing when the first answer is valid", async () => {
    const { manager, log } = await createManager([say("All good.")]);

    await manager.handleMessage("Do something");

    expect(await rejections(log)).toEqual([]);
  });

  it("records all three attempts when none is valid", async () => {
    const wrong = () => say("x", { options: ["orphan"] });
    const { manager, chat, log } = await createManager([wrong(), wrong(), wrong()]);

    await manager.handleMessage("Do something");

    expect((await rejections(log)).map((payload) => (payload as { attempt: number }).attempt)).toEqual([1, 2, 3]);
    expect(chat.messages().at(-1)?.text).toContain("could not produce a valid answer");
  });
});

describe("consulting advisors", () => {
  const roster = [
    { name: "architect", description: "how a change fits the code" },
    { name: "reviewer", description: "skeptical review of the scope" },
  ];

  function bench(answer: (request: AdvisorRequest) => AdvisorReply["result"] = () => ok("advice")) {
    const calls: AdvisorRequest[][] = [];
    const advisors: AdvisorBench = {
      roster: () => roster,
      async consult(requests) {
        calls.push([...requests]);
        return requests.map((request) => ({ role: request.role, result: answer(request) }));
      },
    };
    return { advisors, calls };
  }

  const consult = (...roles: string[]) =>
    say("Let me check.", { consult: roles.map((role) => ({ role, question: `What do you think, ${role}?` })) });

  const eventTypes = async (log: Awaited<ReturnType<typeof createManager>>["log"]) =>
    (await log.readAfter(0)).map((event) => event.type).filter((type) => type.startsWith("manager.") && type !== "manager.message_received");

  it("asks the advisors once, hands their answers back and acts on the final answer", async () => {
    const { advisors, calls } = bench((request) => ok(`${request.role} says: split it`));
    const { manager, chat, prompts, log } = await createManager([consult("architect", "reviewer"), say("Two steps, then.")], advisors);

    await manager.handleMessage("Rework the export");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((request) => request.role)).toEqual(["architect", "reviewer"]);
    expect(prompts[0]).toContain("- architect: how a change fits the code");
    expect(prompts[1]).toContain("architect says: split it");
    expect(prompts[1]).toContain("Do not consult again");
    expect(chat.messages().at(-1)?.text).toBe("Two steps, then.");
    expect(await eventTypes(log)).toEqual(["manager.consulted", "manager.consulted", "manager.advised", "manager.advised", "manager.replied"]);
  });

  it("keeps going when an advisor fails, and tells the Manager", async () => {
    const { advisors } = bench((request) => (request.role === "reviewer" ? err("it timed out") : ok("fine")));
    const { manager, chat, prompts, log } = await createManager([consult("architect", "reviewer"), say("Going on without the reviewer.")], advisors);

    await manager.handleMessage("Rework the export");

    expect(prompts[1]).toContain("(could not answer: it timed out)");
    expect(chat.messages().at(-1)?.text).toBe("Going on without the reviewer.");
    expect(await eventTypes(log)).toContain("manager.advisor_failed");
  });

  it("treats a bench that throws as every advisor failing", async () => {
    const advisors: AdvisorBench = { roster: () => roster, consult: async () => Promise.reject(new Error("bench down")) };
    const { manager, chat, prompts } = await createManager([consult("architect"), say("Alone, then.")], advisors);

    await manager.handleMessage("Rework the export");

    expect(prompts[1]).toContain("(could not answer: bench down)");
    expect(chat.messages().at(-1)?.text).toBe("Alone, then.");
  });

  it("sends an unknown advisor back to the model with the list of real ones", async () => {
    const { advisors, calls } = bench();
    const { manager, prompts } = await createManager([consult("oracle"), consult("architect"), say("Done.")], advisors);

    await manager.handleMessage("Rework the export");

    expect(prompts[1]).toContain('unknown advisor "oracle"; available: architect, reviewer');
    expect(calls).toHaveLength(1);
  });

  it("does not let the Manager consult a second time in the same turn", async () => {
    const { advisors, calls } = bench();
    const { manager, chat, prompts } = await createManager([consult("architect"), consult("reviewer"), say("Final.")], advisors);

    await manager.handleMessage("Rework the export");

    expect(calls).toHaveLength(1);
    expect(prompts[2]).toContain("you cannot consult now");
    expect(chat.messages().at(-1)?.text).toBe("Final.");
  });

  it("tells the model it cannot consult when the team has no advisors", async () => {
    const { manager, prompts } = await createManager([consult("architect"), say("Alone.")]);

    await manager.handleMessage("Rework the export");

    expect(prompts[0]).toContain("(none)");
    expect(prompts[1]).toContain("you cannot consult now");
  });

  it("rejects a consultation that also asks or proposes, and the same advisor twice", () => {
    const schema = createAnswerSchema(WorkOrderSpecSchema, ["architect"]);
    const base = { message: "x", question: null, options: [], order: null, consult: [{ role: "architect", question: "Thoughts?" }] };

    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, question: "Which one?" }).success).toBe(false);
    expect(schema.safeParse({ ...base, order: validSpec() }).success).toBe(false);
    expect(schema.safeParse({ ...base, consult: [...base.consult, ...base.consult] }).success).toBe(false);
    expect(schema.safeParse({ ...base, consult: Array(4).fill({ role: "architect", question: "Thoughts?" }) }).success).toBe(false);
  });
});
