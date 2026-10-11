import { describe, expect, it } from "vitest";
import { agentWork } from "../src/application/agent-work";
import type { Activity, Agent, Order, Project, Run } from "../src/contracts";

const order = (id: string, overrides: Partial<Order> = {}) =>
  ({ id, title: `Order ${id}`, status: "on_bench", working: false, worker: null, blocked: null, question: null, pullRequest: null, issue: null, ...overrides }) as Order;
const entry = (sequence: number, overrides: Partial<Activity>) => ({ sequence, role: null, by: null, orderId: null, text: `event ${sequence}`, ...overrides }) as Activity;
const agent = (id: string, kind: Agent["kind"], overrides: Partial<Agent> = {}) => ({ id, kind, orderId: null, ...overrides }) as Agent;
const project = (overrides: Partial<Project>) => ({ orders: [], activity: [], runs: [], ...overrides }) as unknown as Project;

const developer = agent("developer", "worker");
const reach = (orders: Order[], who = developer) => {
  const { kind, ...rest } = agentWork(project({ orders }), who).reach;
  return "order" in rest ? `${kind} ${rest.order.id}` : kind;
};

describe("what an agent's desk shows", () => {
  it("gives a worker the orders nobody else holds, and leaves out the closed ones", () => {
    const work = agentWork(
      project({ orders: [order("WO-0001"), order("WO-0002", { worker: "careful" }), order("WO-0003", { status: "delivered" }), order("WO-0004", { status: "awaiting_signature" })] }),
      developer,
    );

    expect(work.open.map((held) => held.id)).toEqual(["WO-0001"]);
  });

  it("traces what names the agent and the steps of its own orders, not another role's run on them", () => {
    const activity = [
      entry(5, { role: "code_reviewer", orderId: "WO-0001" }),
      entry(4, { orderId: "WO-0001" }),
      entry(3, { role: "developer", orderId: "WO-0001" }),
      entry(2, { orderId: "WO-0002" }),
      entry(1, { role: "architect" }),
      entry(0, { by: "developer", orderId: "WO-0002" }),
    ];
    const orders = [order("WO-0001", { status: "delivered" }), order("WO-0002", { worker: "careful" })];

    expect(agentWork(project({ orders, activity }), developer).trace.map((item) => item.sequence)).toEqual([4, 3, 0]);
    expect(agentWork(project({ orders, activity }), agent("architect", "advisor")).trace.map((item) => item.sequence)).toEqual([1]);
  });

  it("keeps only the agent's own runs", () => {
    const runs = [{ runId: "run_1", role: "developer" }, { runId: "run_2", role: "manager" }] as unknown as Run[];

    expect(agentWork(project({ runs }), developer).runs.map((run) => run.runId)).toEqual(["run_1"]);
  });

  it("names the order the agent is on, and none when it is on a turn without one", () => {
    const orders = [order("WO-0001"), order("WO-0002", { working: true })];

    expect(agentWork(project({ orders }), agent("developer", "worker", { orderId: "WO-0001" })).current?.id).toBe("WO-0001");
    expect(agentWork(project({ orders }), developer).current?.id).toBe("WO-0002");
    expect(agentWork(project({ orders: [order("WO-0001")] }), developer).current).toBeNull();
  });
});

describe("where the director's words go", () => {
  it("answers the worker's question before anything else", () => {
    expect(reach([order("WO-0001", { status: "in_review", pullRequest: 7, issue: 3 }), order("WO-0002", { question: "Which color?" })])).toBe("answer WO-0002");
  });

  it("redirects an order in review only when it has a pull request to follow up on", () => {
    expect(reach([order("WO-0001", { status: "in_review", pullRequest: 7, issue: 3 })])).toBe("redirect WO-0001");
    expect(reach([order("WO-0001", { status: "in_review", pullRequest: null, issue: 3 })])).toBe("manager");
  });

  it("goes through the Manager while the order is being worked, which the service would refuse to interrupt", () => {
    expect(reach([order("WO-0001", { status: "in_review", pullRequest: 7, issue: 3, working: true })])).toBe("manager");
    expect(reach([order("WO-0001", { question: "Which color?", working: true })])).toBe("manager");
  });

  it("never addresses an advisor or the Manager through an order, even one the developer holds", () => {
    const orders = [order("WO-0001", { question: "Which color?" })];

    expect(reach(orders, agent("architect", "advisor"))).toBe("manager");
    expect(reach(orders, agent("manager", "manager"))).toBe("manager");
  });

  it("offers a retry for a blocked order on the bench, and not for one in review or being worked", () => {
    const retry = (overrides: Partial<Order>) => agentWork(project({ orders: [order("WO-0001", { blocked: "the checks failed", ...overrides })] }), developer).retry?.id ?? null;

    expect(retry({})).toBe("WO-0001");
    expect(retry({ status: "signed" })).toBe("WO-0001");
    expect(retry({ status: "in_review" })).toBeNull();
    expect(retry({ working: true })).toBeNull();
    expect(retry({ blocked: null })).toBeNull();
  });
});
