import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpGateway, mapState } from "../src/adapters/http-gateway";
import type { InboxItem, Order, ShopState } from "../src/contracts";

const ACCENTS = ["mint", "lavender"];

type RunId = ShopState["presence"]["working"][number]["runId"];
const run = (id: string) => id as RunId;

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id: id as Order["id"],
    title: `Order ${id}`,
    objective: "Ship it",
    risk: "low",
    criteria: [],
    outOfScope: [],
    status: "on_bench",
    card: "",
    pullRequest: null,
    ticket: null,
    minutes: null,
    proposedAt: "2026-10-01T10:00:00.000Z",
    signedAt: "2026-10-01T10:05:00.000Z",
    deliveredAt: null,
    spentUsd: 0,
    issue: null,
    issueUrl: null,
    pullRequestUrl: null,
    blocked: null,
    protectedPaths: [],
    approvedPaths: [],
    waitingOn: [],
    worker: null,
    question: null,
    questionAt: null,
    answers: [],
    reviews: 0,
    review: null,
    checks: null,
    ready: false,
    ...overrides,
  };
}

function question(overrides: Partial<InboxItem>): InboxItem {
  return { id: "d1", kind: "manager_question", from: "manager", question: "Which one?", options: [], orderId: null, ticket: null, askedAt: "2026-10-01T11:00:00.000Z", ...overrides };
}

function shopState(overrides: Partial<ShopState> = {}): ShopState {
  return {
    project: { id: "shop", repo: "skynot-labs/shop" },
    projects: [
      { id: "blog", repo: "skynot-labs/blog", awaitingSignature: 1, blocked: 0, questions: 2, needsYou: 3 },
      { id: "shop", repo: "skynot-labs/shop", awaitingSignature: 0, blocked: 0, questions: 0, needsYou: 0 },
      { id: "docs", repo: "skynot-labs/docs", awaitingSignature: 0, blocked: 0, questions: 0, needsYou: 0 },
    ],
    repo: "skynot-labs/shop",
    reviewing: true,
    readiness: [],
    workers: ["backend_dev"],
    cursor: 42,
    orders: [],
    chat: [],
    decisions: [],
    inbox: [],
    team: [
      { role: "manager", name: "Ada", engine: "claude", model: "opus" },
      { role: "developer", name: null, engine: "codex", model: null },
      { role: "backend_dev", name: null, engine: "claude", model: null },
      { role: "ui-designer", name: null, engine: "claude", model: null },
    ],
    teamChanges: [],
    briefingChanges: [],
    briefing: null,
    hireable: [],
    paused: null,
    costs: { today: 1.5, total: 20, cap: 5, project: 7.25 },
    presence: { working: [], waiting: [] },
    activity: [],
    simulated: true,
    ...overrides,
  };
}

function agent(state: ShopState, id: string) {
  const found = mapState(state, ACCENTS).project.agents.find((entry) => entry.id === id);
  if (!found) throw new Error(`no agent ${id}`);
  return found;
}

describe("mapState", () => {
  it("names projects after the repository and gives each a stable accent by position", () => {
    const snapshot = mapState(shopState(), ACCENTS);

    expect(snapshot.projects.map(({ name, accent }) => ({ name, accent }))).toEqual([
      { name: "blog", accent: "mint" },
      { name: "shop", accent: "lavender" },
      { name: "docs", accent: "mint" },
    ]);
    expect(snapshot.project).toMatchObject({ id: "shop", name: "shop", repo: "skynot-labs/shop", accent: "lavender" });
    expect(snapshot.projects[0]?.needsYou).toBe(3);
  });

  it("reports the project's own spend apart from the shop-wide costs", () => {
    const snapshot = mapState(shopState(), ACCENTS);

    expect(snapshot.project.spentUsd).toBe(7.25);
    expect(snapshot.costs).toEqual({ today: 1.5, total: 20, cap: 5 });
    expect(snapshot.cursor).toBe(42);
    expect(snapshot.simulated).toBe(true);
  });

  it("shows a member's given name, or the role in plain words when it has none", () => {
    const state = shopState();

    expect(agent(state, "manager")).toMatchObject({ name: "Ada", role: "manager", model: "opus" });
    expect(agent(state, "backend_dev")).toMatchObject({ name: "backend dev", role: "backend dev", engine: "claude" });
    expect(agent(state, "ui-designer").name).toBe("ui designer");
  });

  it("tells the manager, the workers and the advisors apart", () => {
    const state = shopState({
      team: [...shopState().team, { role: "qa", name: null, engine: "claude", model: null }],
      orders: [order("wo-1", { worker: "qa" })],
    });

    expect(agent(state, "manager").kind).toBe("manager");
    expect(agent(state, "developer").kind).toBe("worker");
    expect(agent(state, "backend_dev").kind).toBe("worker");
    expect(agent(state, "qa").kind).toBe("worker");
    expect(agent(state, "ui-designer").kind).toBe("advisor");
  });

  it("marks an agent working on its live run and queued with its place in line", () => {
    const state = shopState({
      presence: {
        working: [{ runId: run("run-1"), role: "developer", engine: "codex", orderId: "wo-1", since: "2026-10-01T12:00:00.000Z" }],
        waiting: [{ runId: run("run-2"), role: "backend_dev", orderId: "wo-2", position: 3 }],
      },
    });

    expect(agent(state, "developer")).toMatchObject({ status: "working", runId: run("run-1"), orderId: "wo-1", queuePosition: null });
    expect(agent(state, "backend_dev")).toMatchObject({ status: "queued", runId: run("run-2"), orderId: "wo-2", queuePosition: 3 });
  });

  it("leaves an agent with no run idle", () => {
    const state = shopState({
      presence: { working: [{ runId: run("run-1"), role: "developer", engine: "codex", orderId: "wo-1", since: null }], waiting: [] },
    });

    expect(agent(state, "backend_dev")).toMatchObject({ status: "idle", runId: null, orderId: null, queuePosition: null });
    expect(agent(state, "manager").status).toBe("idle");
  });

  it("has the manager wait for the director while its question or a ticket doubt is open", () => {
    expect(agent(shopState({ inbox: [question({ kind: "manager_question" })] }), "manager").status).toBe("waiting-director");
    expect(agent(shopState({ inbox: [question({ kind: "ticket_doubt", ticket: 12 })] }), "manager").status).toBe("waiting-director");
  });

  it("has only the worker who asked wait for the director", () => {
    const state = shopState({
      orders: [order("wo-1", { worker: "backend_dev", question: "Which table?" }), order("wo-2")],
      inbox: [question({ id: "question:wo-1", kind: "worker_question", from: "backend_dev", orderId: "wo-1" })],
    });

    expect(agent(state, "backend_dev")).toMatchObject({ status: "waiting-director", orderId: "wo-1", runId: null });
    expect(agent(state, "developer").status).toBe("idle");
    expect(agent(state, "manager").status).toBe("idle");
  });

  it("keeps a running agent working even with a question open", () => {
    const state = shopState({
      inbox: [question({ kind: "manager_question" })],
      presence: { working: [{ runId: run("run-9"), role: "manager", engine: "claude", orderId: null, since: null }], waiting: [] },
    });

    expect(agent(state, "manager")).toMatchObject({ status: "working", runId: run("run-9") });
  });
});

describe("HttpGateway", () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

  function answerWith(...responses: Array<{ status: number; body: unknown }>) {
    calls.length = 0;
    const queue = [...responses];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`unexpected request to ${url}`);
      return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), { status: next.status });
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("refuses an API on another origin", () => {
    expect(() => new HttpGateway("https://elsewhere.test/api")).toThrow();
    expect(() => new HttpGateway("//elsewhere.test/api")).toThrow();
  });

  it("reads the default project when none is asked for", async () => {
    answerWith({ status: 200, body: shopState() });

    const snapshot = await new HttpGateway().read();

    expect(calls.map((call) => call.url)).toEqual(["/api/state"]);
    expect(snapshot.project.id).toBe("shop");
  });

  it("reads the project it is asked for", async () => {
    answerWith({ status: 200, body: shopState() });

    await new HttpGateway().read("shop & co");

    expect(calls.map((call) => call.url)).toEqual(["/api/state?project=shop%20%26%20co"]);
  });

  it("falls back to the default project when the asked one is gone", async () => {
    answerWith({ status: 404, body: { error: "no project gone" } }, { status: 200, body: shopState() });

    const snapshot = await new HttpGateway().read("gone");

    expect(calls.map((call) => call.url)).toEqual(["/api/state?project=gone", "/api/state"]);
    expect(snapshot.project.id).toBe("shop");
  });

  it("fails a read the shop refuses, with the shop's own reason", async () => {
    answerWith({ status: 403, body: { error: "unknown host" } });

    await expect(new HttpGateway().read()).rejects.toThrow("unknown host");
  });

  it("posts a command with its payload", async () => {
    answerWith({ status: 200, body: { id: "wo-1", status: "signed" } });

    await new HttpGateway().send({ name: "reassign-order", payload: { orderId: "wo-1", worker: "backend_dev" } });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/commands/reassign-order");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ orderId: "wo-1", worker: "backend_dev" });
  });

  it("sends the simulated merge to the dev route", async () => {
    answerWith({ status: 200, body: { merged: true } });

    await new HttpGateway().send({ name: "merge-pull-request", payload: { orderId: "wo-1" } });

    expect(calls.map((call) => call.url)).toEqual(["/api/dev/merge-pull-request"]);
  });

  it("rejects with the shop's reason when a command is refused", async () => {
    answerWith({ status: 409, body: { error: "wo-1 has no requested changes to apply" } });

    await expect(new HttpGateway().send({ name: "apply-review", payload: { orderId: "wo-1" } })).rejects.toThrow("wo-1 has no requested changes to apply");
  });

  it("still rejects a refused command whose answer carries no reason", async () => {
    answerWith({ status: 502, body: "<html>Bad Gateway</html>" });

    await expect(new HttpGateway().send({ name: "recheck", payload: {} })).rejects.toThrow("502");
  });
});
