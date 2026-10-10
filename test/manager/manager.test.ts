import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createManagerRunner } from "../../src/app/model-runner";
import { createOrderDesk } from "../../src/app/order-desk";
import { FakeEngine, RunScheduler } from "../../src/execution";
import { err, fixedClock, ok, type Clock, type Result } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { ChatProjection, ManagerService, SYSTEM_PROMPT, createAnswerSchema, type AdvisorBench, type AdvisorReply, type AdvisorRequest, type ModelRunner, type TeamDesk, type TeamProposal } from "../../src/manager";
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
  ok({ message, question: null, options: [], order: null, consult: [], team: null, ...extra });

function tickingClock(): Clock {
  let seconds = 0;
  return { now: () => new Date(Date.UTC(2026, 9, 9, 12, 0, seconds++)) };
}

async function createManager(script: Script, advisors?: AdvisorBench, team?: TeamDesk, clock: Clock = fixedClock(new Date("2026-10-09T12:00:00.000Z"))) {
  const log = new EventLog(new InMemoryEventStore(), clock);
  const orders = new OrdersProjection();
  const chat = new ChatProjection();
  await attachProjection(log, orders);
  await attachProjection(log, chat);
  const orderService = new OrderService(log, orders);
  const { runner, prompts } = scriptedRunner(script);
  const manager = new ManagerService({ log, chat, runner, desk: createOrderDesk(orderService, orders), ...(advisors && { advisors }), ...(team && { team }) });
  return { manager, chat, orders, orderService, prompts, log };
}

describe("answer schema", () => {
  const schema = createAnswerSchema(WorkOrderSpecSchema);
  const reply = { message: "Done.", question: null, options: [], order: null, consult: [], team: null };

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

  it("keeps an answered question as history, with when it was asked and when it was answered", async () => {
    const { manager, chat, log } = await createManager(
      [say("One thing first.", { question: "Include archived items?", options: ["Yes", "Only active"] }), say("Which colour?", { question: "Which colour?", options: [] })],
      undefined,
      undefined,
      tickingClock(),
    );
    await manager.handleMessage("Export items to CSV");
    expect(chat.answeredDecisions()).toEqual([]);
    const [decision] = chat.openDecisions();

    await manager.answerDecision(decision!.id, "Only active");

    const events = await log.readAfter(0);
    const at = (type: string) => events.find((event) => event.type === type)!.occurredAt;
    expect(at("manager.decision_answered") > at("manager.decision_asked")).toBe(true);
    expect(chat.answeredDecisions()).toEqual([
      { id: decision!.id, question: "Include archived items?", options: ["Yes", "Only active"], ticket: null, answer: "Only active", askedAt: at("manager.decision_asked"), answeredAt: at("manager.decision_answered") },
    ]);
    expect(chat.openDecisions().map((open) => open.question)).toEqual(["Which colour?"]);
    expect(chat.openDecisions()[0]?.answeredAt).toBeNull();
  });

  it("keeps the ticket number of an answered doubt, and a rebuilt conversation tells the same history", async () => {
    const { manager, chat, log } = await createManager([say("I need to know more.", { question: "Which pages get the feed?", options: [] }), say("Understood.")]);
    await manager.handleTicket({ number: 42, title: "Add an RSS feed", body: "" });

    await manager.answerDecision(chat.openDecisions()[0]!.id, "Only the blog");

    expect(chat.answeredDecisions()).toMatchObject([{ ticket: 42, question: "Which pages get the feed?", answer: "Only the blog" }]);
    const rebuilt = new ChatProjection();
    await attachProjection(log, rebuilt);
    expect(rebuilt.answeredDecisions()).toEqual(chat.answeredDecisions());
    expect(rebuilt.openDecisions()).toEqual([]);
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

describe("system prompt", () => {
  it("states every length limit of a work order, so the model is not rejected for what it could not know", () => {
    const spec = z.toJSONSchema(WorkOrderSpecSchema) as { properties: Record<string, any> };
    const { title, objective, acceptanceCriteria, outOfScope, likelyFiles } = spec.properties;
    const criterion = acceptanceCriteria.items.properties;
    const limits = [
      title.maxLength,
      objective.maxLength,
      acceptanceCriteria.maxItems,
      criterion.statement.maxLength,
      criterion.verification.properties.detail.maxLength,
      outOfScope.maxItems,
      likelyFiles.maxItems,
      outOfScope.items.maxLength,
    ];

    expect(limits.every((limit) => typeof limit === "number" && SYSTEM_PROMPT.includes(String(limit)))).toBe(true);
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
    const base = { message: "x", question: null, options: [], order: null, team: null, consult: [{ role: "architect", question: "Thoughts?" }] };

    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, question: "Which one?" }).success).toBe(false);
    expect(schema.safeParse({ ...base, order: validSpec() }).success).toBe(false);
    expect(schema.safeParse({ ...base, consult: [...base.consult, ...base.consult] }).success).toBe(false);
    expect(schema.safeParse({ ...base, consult: Array(4).fill({ role: "architect", question: "Thoughts?" }) }).success).toBe(false);
  });
});

describe("proposing team changes", () => {
  const roster = [{ name: "architect", description: "how a change fits the code" }];
  const advisors: AdvisorBench = { roster: () => roster, consult: async () => [] };

  function desk(answer: () => Result<{ text: string }, string> = () => ok({ text: "Change chg_1 is waiting for your signature." })) {
    const proposals: TeamProposal[] = [];
    const teamDesk: TeamDesk = {
      hireable: () => [{ name: "designer", description: "screens and wording" }],
      async propose(proposal) {
        proposals.push(proposal);
        return answer();
      },
    };
    return { teamDesk, proposals };
  }

  const propose = (action: "hire" | "dismiss", role: string) => say("A designer would help.", { team: { action, role, reason: "the order is mostly wording" } });

  it("hands a valid proposal to the team desk and tells the director it waits for a signature", async () => {
    const { teamDesk, proposals } = desk();
    const { manager, chat, prompts } = await createManager([propose("hire", "designer")], advisors, teamDesk);

    await manager.handleMessage("Rewrite all the error messages");

    expect(prompts[0]).toContain("- designer: screens and wording");
    expect(proposals).toEqual([{ action: "hire", role: "designer", reason: "the order is mostly wording" }]);
    expect(chat.messages().at(-1)?.text).toBe("A designer would help.\n\nChange chg_1 is waiting for your signature.");
  });

  it("proposes to dismiss someone on the team", async () => {
    const { teamDesk, proposals } = desk();
    const { manager } = await createManager([propose("dismiss", "architect")], advisors, teamDesk);

    await manager.handleMessage("The architect never helps");

    expect(proposals).toMatchObject([{ action: "dismiss", role: "architect" }]);
  });

  it("sends a proposal for someone who cannot be hired or dismissed back with the real choices", async () => {
    const { teamDesk, proposals } = desk();
    const { manager, prompts } = await createManager([propose("hire", "oracle"), propose("dismiss", "designer"), propose("hire", "designer")], advisors, teamDesk);

    await manager.handleMessage("We need help");

    expect(prompts[1]).toContain('cannot hire "oracle"; available: designer');
    expect(prompts[2]).toContain('cannot dismiss "designer"; available: architect');
    expect(proposals).toHaveLength(1);
  });

  it("says plainly when the desk refuses the proposal", async () => {
    const { teamDesk } = desk(() => err("there is already a pending change for designer"));
    const { manager, chat } = await createManager([propose("hire", "designer")], advisors, teamDesk);

    await manager.handleMessage("We need help");

    expect(chat.messages().at(-1)?.text).toBe("I could not propose that: there is already a pending change for designer");
  });

  it("does not let a team proposal travel with an order, a question or a consultation", () => {
    const schema = createAnswerSchema(WorkOrderSpecSchema, ["architect"], { hire: ["designer"], dismiss: ["architect"] });
    const base = { message: "x", question: null, options: [], order: null, consult: [], team: { action: "hire", role: "designer", reason: "wording heavy" } };

    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, question: "Which?" }).success).toBe(false);
    expect(schema.safeParse({ ...base, order: validSpec() }).success).toBe(false);
    expect(schema.safeParse({ ...base, consult: [{ role: "architect", question: "Thoughts?" }] }).success).toBe(false);
  });

  it("cannot propose anything when there is no team desk", async () => {
    const { manager, prompts } = await createManager([propose("hire", "designer"), say("Fine.")]);

    await manager.handleMessage("We need help");

    expect(prompts[1]).toContain("nobody can be hired now");
  });
});

describe("refocus and briefing proposals", () => {
  const schema = createAnswerSchema(WorkOrderSpecSchema, ["architect"], { hire: [], dismiss: ["architect"], refocus: ["architect"] });
  const base = { message: "ok", question: null, options: [], order: null, consult: [], team: null, briefing: null };

  it("accepts a refocus with its focus, and refuses one without it or for someone off the team", () => {
    expect(schema.safeParse({ ...base, team: { action: "refocus", role: "architect", reason: "needs it", focus: "performance" } }).success).toBe(true);
    expect(schema.safeParse({ ...base, team: { action: "refocus", role: "architect", reason: "needs it", focus: null } }).success).toBe(false);
    expect(schema.safeParse({ ...base, team: { action: "refocus", role: "ghost", reason: "needs it", focus: "x y z" } }).success).toBe(false);
  });

  it("accepts a briefing change only on its own", () => {
    const briefing = { text: "Marta reads only Spanish.", reason: "the director said so" };

    expect(schema.safeParse({ ...base, briefing }).success).toBe(true);
    expect(schema.safeParse({ ...base, briefing, question: "Which one?" }).success).toBe(false);
    expect(schema.safeParse({ ...base, briefing: { ...briefing, text: "x".repeat(1501) } }).success).toBe(false);
  });

  it("does not need the fields an older answer never had", () => {
    const { briefing: _briefing, ...older } = base;
    expect(schema.safeParse({ ...older, team: { action: "dismiss", role: "architect", reason: "abc" } }).success).toBe(true);
    expect(schema.safeParse(older).success).toBe(true);
  });

  it("states both rules in the prompt, with the limit of the briefing", () => {
    expect(SYSTEM_PROMPT).toContain("refocus");
    expect(SYSTEM_PROMPT).toContain("at most 1500 characters");
  });
});
