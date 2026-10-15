import { describe, expect, it } from "vitest";
import type { Agent, Order, Project } from "../src/contracts";
import { agentBubble, agentErrand } from "../src/studio/presentation";

const order = (id: string, overrides: Partial<Order> = {}) =>
  ({ id, status: "on_bench", working: false, worker: null, blocked: null, question: null, pullRequest: null, issue: null, ready: false, ...overrides }) as Order;
const agent = (id: string, kind: Agent["kind"], status: Agent["status"] = "idle") => ({ id, kind, status, orderId: null }) as Agent;
const project = (overrides: Partial<Project> = {}) => ({ orders: [], activity: [], runs: [], inbox: [], teamChanges: [], briefingChanges: [], commandsChanges: [], ...overrides }) as unknown as Project;

const developer = agent("developer", "worker");
const manager = agent("manager", "manager");
const shown = (overrides: Partial<Project>, who = developer) => {
  const bubble = agentBubble(project(overrides), who);
  return bubble && [bubble.text, bubble.open];
};
const inReview = (overrides: Partial<Order> = {}) => order("WO-0001", { status: "in_review", pullRequest: 7, issue: 3, ...overrides });

describe("the bubble over an agent's desk", () => {
  it("shows nothing over an agent with nothing to say", () => {
    expect(shown({})).toBeNull();
    expect(shown({ orders: [order("WO-0001")] })).toBeNull();
    expect(shown({}, manager)).toBeNull();
  });

  it("says a worker asks, and leads to its desk, where the answer is given", () => {
    expect(shown({ orders: [order("WO-0001", { question: "Which color?" })] })).toEqual(["? ASKS YOU", { kind: "agent" }]);
  });

  it("puts a question before a finished order, and a blocked order before a finished one", () => {
    expect(shown({ orders: [inReview(), order("WO-0002", { question: "Which color?" })] })?.[0]).toBe("? ASKS YOU");
    expect(shown({ orders: [inReview(), order("WO-0002", { blocked: "the checks failed" })] })?.[0]).toBe("! BLOCKED");
  });

  it("says a pull request is open, or ready once it is reviewed, and leads to the order", () => {
    expect(shown({ orders: [inReview()] })).toEqual(["✓ PR OPEN", { kind: "order", id: "WO-0001" }]);
    expect(shown({ orders: [inReview({ ready: true })] })).toEqual(["✓ READY TO MERGE", { kind: "order", id: "WO-0001" }]);
  });

  it("does not call an order finished while a follow-up is still running on it", () => {
    expect(shown({ orders: [inReview({ working: true })] }, agent("developer", "worker", "working"))?.[0]).toBe("···");
  });

  it("never shows one worker another worker's order", () => {
    expect(shown({ orders: [inReview({ worker: "careful" })] })).toBeNull();
  });

  it("shows a run in progress, a place in line and a failed run", () => {
    expect(shown({}, agent("architect", "advisor", "working"))?.[0]).toBe("···");
    expect(shown({}, agent("developer", "worker", "queued"))?.[0]).toBe("IN LINE");
    expect(shown({}, agent("developer", "worker", "error"))?.[0]).toBe("! RUN FAILED");
  });

  it("holds the Manager's questions and what waits for a signature over the Manager, each leading to its tab of the desk", () => {
    const question = { kind: "manager_question" } as Project["inbox"][number];
    const fromWorker = { kind: "worker_question" } as Project["inbox"][number];
    const toSign = [order("WO-0001", { status: "awaiting_signature" })];

    expect(shown({ inbox: [question], orders: toSign }, manager)).toEqual(["? ASKS YOU", { kind: "desk", tab: "questions" }]);
    expect(shown({ inbox: [question, question] }, manager)?.[0]).toBe("? 2 QUESTIONS");
    expect(shown({ orders: toSign, teamChanges: [{}] as Project["teamChanges"] }, manager)).toEqual(["2 TO SIGN", { kind: "desk", tab: "signatures" }]);
    expect(shown({ inbox: [fromWorker] }, manager)).toBeNull();
  });

  it("holds an unread reply over the Manager, after what waits on the director, and over nobody else", () => {
    const replied = (overrides: Partial<Project>, who: Agent, unread: number) => agentBubble(project(overrides), who, unread);

    expect(replied({}, manager, 1)).toEqual({ tone: "done", text: "REPLIED", open: { kind: "agent" } });
    expect(replied({}, manager, 3)?.text).toBe("3 REPLIES");
    expect(replied({ inbox: [{ kind: "manager_question" }] as Project["inbox"] }, manager, 1)?.text).toBe("? ASKS YOU");
    expect(replied({}, developer, 2)).toBeNull();
  });
});

describe("where an agent's work takes it", () => {
  const working = (id: string, kind: Agent["kind"], role: string, orderId: string | null = null) =>
    ({ ...agent(id, kind, "working"), role, orderId }) as Agent;
  const team = (who: Agent) => project({ agents: [manager, developer, who], orders: [inReview()] } as Partial<Project>);
  const errand = (who: Agent) => agentErrand(team(who), who);

  it("takes an advisor being consulted to the Manager", () => {
    expect(errand(working("architect", "advisor", "Architect"))).toEqual({ beside: "manager", doing: "advising" });
  });

  it("takes a reviewer to whoever holds the order under review", () => {
    expect(errand(working("code_reviewer", "advisor", "Code reviewer", "WO-0001"))).toEqual({ beside: "developer", doing: "reviewing WO-0001" });
  });

  it("leaves at their desk whoever is not working, works alone, or reviews an order nobody on the floor holds", () => {
    expect(errand({ ...working("architect", "advisor", "Architect"), status: "idle" } as Agent)).toBeNull();
    expect(errand(working("careful", "worker", "Developer", "WO-0001"))).toBeNull();
    expect(errand(working("code_reviewer", "advisor", "Code reviewer", "WO-0099"))).toBeNull();
  });
});
