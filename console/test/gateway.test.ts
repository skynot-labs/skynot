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
    answered: [],
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
    project: { id: "shop", repo: "skynot-labs/shop", name: null, description: null },
    projects: [
      { id: "blog", repo: "skynot-labs/blog", name: null, description: null, paused: false, awaitingSignature: 1, changes: 0, blocked: 0, questions: 2, needsYou: 3 },
      { id: "shop", repo: "skynot-labs/shop", name: null, description: null, paused: false, awaitingSignature: 0, changes: 0, blocked: 0, questions: 0, needsYou: 0 },
      { id: "docs", repo: "skynot-labs/docs", name: null, description: null, paused: false, awaitingSignature: 0, changes: 0, blocked: 0, questions: 0, needsYou: 0 },
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
    costs: { today: 1.5, total: 20, cap: 5, project: 7.25, tokens: null },
    projectPaused: null,
    runs: [],
    agents: [],
    answered: [],
    preferences: {},
    presence: { working: [], waiting: [] },
    activity: [],
    simulated: true,
    ...overrides,
  };
}

type RoleTotals = ShopState["agents"][number];
function totals(role: string, overrides: Partial<RoleTotals> = {}): RoleTotals {
  return { role, runs: 1, spentUsd: 0, usage: null, lastOutcome: "completed", ...overrides };
}

function finishedRun(id: string, overrides: Partial<ShopState["runs"][number]> = {}): ShopState["runs"][number] {
  return {
    runId: run(id),
    role: "developer",
    engine: "codex",
    model: null,
    turns: null,
    orderId: "WO-0001",
    startedAt: "2026-10-01T12:00:00.000Z",
    finishedAt: "2026-10-01T12:05:00.000Z",
    outcome: "completed",
    failure: null,
    costUsd: null,
    usage: null,
    ...overrides,
  };
}

function agent(state: ShopState, id: string) {
  const found = mapState(state, ACCENTS).project.agents.find((entry) => entry.id === id);
  if (!found) throw new Error(`no agent ${id}`);
  return found;
}

describe("mapState", () => {
  it("takes what waits on the director from the service's count for the project on screen", () => {
    const state = shopState({ project: { id: "blog", repo: "skynot-labs/blog", name: null, description: null } });

    expect(mapState(state, ACCENTS).project.needsYou).toBe(3);
    expect(mapState(shopState(), ACCENTS).project.needsYou).toBe(0);
  });

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

  it("prefers the name the director gave a project over its repository", () => {
    const state = shopState({ project: { id: "shop", repo: "skynot-labs/shop", name: "The Shop", description: "Sells things" } });
    state.projects[0] = { ...state.projects[0]!, name: "Field Notes" };

    const snapshot = mapState(state, ACCENTS);

    expect(snapshot.project).toMatchObject({ name: "The Shop", description: "Sells things" });
    expect(snapshot.projects.map(({ name }) => name)).toEqual(["Field Notes", "shop", "docs"]);
    expect(mapState(shopState(), ACCENTS).project.description).toBeNull();
  });

  it("passes the project's pause, finished runs, answered questions, tokens and the preferences through", () => {
    const paused = { since: "2026-10-01T09:00:00.000Z", reason: "holiday" };
    const runs = [finishedRun("run-7", { outcome: "failed", failure: { kind: "failed", message: "exit 1" } })];
    const tokens = { inputTokens: 1200, outputTokens: 300, cachedInputTokens: null };
    const preferences = { "studio/shop": { place: "kyoto" } };
    const quiet = mapState(shopState(), ACCENTS);
    const snapshot = mapState(shopState({ projectPaused: paused, runs, costs: { ...shopState().costs, tokens }, preferences }), ACCENTS);

    expect(snapshot.project.paused).toEqual(paused);
    expect(snapshot.project.runs).toEqual(runs);
    expect(snapshot.project.tokens).toEqual(tokens);
    expect(snapshot.preferences).toEqual(preferences);
    expect(snapshot.paused).toBeNull();
    expect(quiet.project).toMatchObject({ paused: null, runs: [], answered: [], tokens: null });
    expect(quiet.preferences).toEqual({});
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

  it("gives each agent its own run totals, and none to a role that never ran", () => {
    const usage = { inputTokens: 900, outputTokens: 120, cachedInputTokens: 400 };
    const state = shopState({ agents: [totals("developer", { runs: 4, spentUsd: 1.75, usage })] });

    expect(agent(state, "developer")).toMatchObject({ runs: 4, spentUsd: 1.75, usage });
    expect(agent(state, "backend_dev")).toMatchObject({ runs: 0, spentUsd: null, usage: null });
  });

  it("keeps apart an agent whose runs reported no cost and one whose runs cost nothing", () => {
    const state = shopState({ agents: [totals("developer", { spentUsd: null }), totals("backend_dev", { spentUsd: 0 })] });

    expect([agent(state, "developer").spentUsd, agent(state, "backend_dev").spentUsd]).toEqual([null, 0]);
  });

  it("marks an agent in error only when its last run failed on its own", () => {
    const state = shopState({
      agents: [totals("developer", { lastOutcome: "failed" }), totals("backend_dev", { lastOutcome: "cancelled" }), totals("ui-designer", { lastOutcome: "interrupted" }), totals("manager")],
    });

    expect(agent(state, "developer")).toMatchObject({ status: "error", runId: null, queuePosition: null });
    expect(agent(state, "backend_dev").status).toBe("idle");
    expect(agent(state, "ui-designer").status).toBe("idle");
    expect(agent(state, "manager").status).toBe("idle");
  });

  it("clears the error once the agent has a new run queued or working", () => {
    const failed = [totals("developer", { lastOutcome: "failed" }), totals("backend_dev", { lastOutcome: "failed" })];
    const state = shopState({
      agents: failed,
      presence: {
        working: [{ runId: run("run-4"), role: "backend_dev", engine: "claude", orderId: "wo-2", since: null }],
        waiting: [{ runId: run("run-3"), role: "developer", orderId: "wo-1", position: 1 }],
      },
    });

    expect(agent(state, "developer")).toMatchObject({ status: "queued", runId: run("run-3") });
    expect(agent(state, "backend_dev").status).toBe("working");
  });

  it("shows the failure before an open question from the same worker", () => {
    const state = shopState({
      agents: [totals("backend_dev", { lastOutcome: "failed" })],
      inbox: [question({ id: "question:wo-1", kind: "worker_question", from: "backend_dev", orderId: "wo-1" })],
    });

    expect(agent(state, "backend_dev")).toMatchObject({ status: "error", orderId: "wo-1" });
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

  it("says so when the service is an older version than the console", async () => {
    const { agents: _agents, runs: _runs, ...older } = shopState();
    answerWith({ status: 200, body: older });

    await expect(new HttpGateway().read()).rejects.toThrow("different versions");
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

  it("posts the project and preference commands like any other", async () => {
    answerWith({ status: 200, body: {} }, { status: 201, body: {} }, { status: 200, body: {} });
    const gateway = new HttpGateway();

    await gateway.send({ name: "pause-project", payload: { project: "shop" } });
    await gateway.send({ name: "register-project", payload: { id: "blog", repo: "skynot-labs/blog", baseBranch: "main", verifyCommands: ["npm test"] } });
    await gateway.send({ name: "set-preference", payload: { key: "studio/shop", value: null } });

    expect(calls.map((call) => call.url)).toEqual(["/api/commands/pause-project", "/api/commands/register-project", "/api/commands/set-preference"]);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ key: "studio/shop", value: null });
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
