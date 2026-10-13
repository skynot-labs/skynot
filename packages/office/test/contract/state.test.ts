import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OrderStatusSchema, StateSchema, type State } from "@skynot/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "../../src/app/http/api";
import { createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace, type FileChange } from "../../src/delivery";
import { FakeEngine } from "../../src/execution";
import type { Project } from "../../src/projects";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

const HOST = "studio";
const BLOG = "acme/blog";
// Every prompt, a worker's or the reviewer's, carries its order's objective; that is how the engine below tells the orders apart.
const BANNER = "The home page shows a banner the director can edit.";
const PAYMENTS = "The shop takes payments by card at checkout.";
const SEARCH = "Visitors can search every post from one box.";

const project = (id: string): Project => ({ id, name: null, description: null, repo: `acme/${id}`, baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [".github/"] });

const plainTeam: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };
const blogTeam: Team = {
  version: 1,
  roles: { manager: { engine: "claude", name: "Ada" }, developer: { engine: "codex" }, code_reviewer: { engine: "codex", model: "reviewer" } },
  workers: { tester: { engine: "codex", model: "small" } },
  advisors: { architect: { engine: "claude", description: "keeps the design coherent", soul: "You are the architect." } },
  library: { designer: { engine: "claude", description: "draws the screens", soul: "You design." } },
};

class TouchingWorkspace extends FakeWorkspace {
  touched = "src/feature.txt";

  override async changes(): Promise<FileChange[]> {
    return [{ status: "A", path: this.touched }];
  }
}

// Stands in for codex, which the team uses for its workers (write access) and its reviewer (read access).
function createCodex(searchMayFinish: Promise<void>): FakeEngine {
  return new FakeEngine(async ({ access, prompt }) => {
    if (access === "read") {
      if (!prompt.includes(BANNER)) return { structured: { verdict: "approved", summary: "Matches the order.", findings: [] } };
      const stillHardcoded = { verdict: "changes_requested", summary: "The banner ignores the dark theme.", findings: ["src/banner.ts: the color is hardcoded"] };
      return prompt.includes("Your findings from the last round")
        ? { structured: { ...stillHardcoded, findings: [], earlier: [{ finding: 1, status: "not_fixed", proof: "src/banner.ts:3 still sets #00ff00" }] } }
        : { structured: stillHardcoded };
    }
    if (prompt.includes(PAYMENTS)) return { kind: "failed", message: "the sandbox refused to start", costUsd: 0.05 };
    if (prompt.includes(BANNER) && !prompt.includes("green")) return { text: "QUESTION: Which color should the banner be?" };
    if (prompt.includes(SEARCH)) await searchMayFinish;
    return { text: "Criterion 1: covered by the new test.", costUsd: 0.31, usage: { inputTokens: 212_000, outputTokens: 6_800, cachedInputTokens: null } };
  });
}

let dataDir: string;
let shop: Shop;
const moments: Array<[string, unknown]> = [];
const at = (moment: string) => moments.find(([name]) => name === moment)![1] as State;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-contract-state-"));
  const vcs = new FakeVcs();
  const workspace = new TouchingWorkspace();
  let finishSearch = () => {};
  const codex = createCodex(new Promise<void>((resolve) => (finishSearch = resolve)));
  shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team: plainTeam,
    teams: { blog: blogTeam },
    projects: [project("blog"), project("shop")],
    engines: { claude: createMockManager(), codex },
    vcs,
    workspace,
    briefing: { read: async () => "from the file" },
    readiness: async () => [
      { check: "gh", level: "ok", detail: "logged in" },
      { check: "codex login", level: "warn", detail: "the token expires tomorrow", fix: "codex login" },
    ],
  });
  await shop.readiness.refresh();
  const api = createApi(shop, { allowedHosts: [HOST], devTools: { mergePullRequest: async () => false } });

  const settle = async () => {
    for (const desk of shop.desks) await desk.manager.idle();
    await shop.flow.idle();
    for (const desk of shop.desks) await desk.manager.idle();
  };
  const send = async (name: string, payload: object) => {
    const response = await api.request(`/api/commands/${name}`, { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (response.status >= 400) throw new Error(`${name} was refused: ${await response.text()}`);
  };
  const command = async (name: string, payload: object) => {
    await send(name, payload);
    await settle();
  };
  const record = async (moment: string, projectId = "blog") => {
    const response = await api.request(`/api/state?project=${projectId}`, { headers: { host: HOST } });
    moments.push([moment, await response.json()]);
  };
  const propose = async (title: string, file: string, overrides: Parameters<typeof validSpec>[0] = {}) => {
    const proposed = await shop.orderService.propose(validSpec({ title, likelyFiles: [file], ...overrides }), { projectId: "blog" });
    if (!proposed.ok) throw new Error(proposed.error.message);
    return proposed.value.id as string;
  };
  const merge = async (orderId: string) => {
    vcs.setPullRequestState(BLOG, shop.orders.get(orderId)!.pullRequest!, "merged");
    await shop.watcher.poll();
    await settle();
  };
  const chat = shop.desk("blog")!.chat;

  await record("an office nobody has spoken to");

  await command("send-message", { text: "Export the inventory to CSV", project: "blog" });
  vcs.tickets.push({ repo: BLOG, label: "taller:ready", number: 7, title: "Dark mode", body: "Please add dark mode.", url: `https://github.com/${BLOG}/issues/7` });
  await shop.intake.poll();
  await settle();
  const [exportQuestion, ticketDoubt] = chat.openDecisions();
  await record("the Manager asks before it writes anything");

  await command("answer-decision", { decisionId: exportQuestion!.id, answer: "Keep it small" });
  const exported = chat.messages().at(-1)!.orderId!;
  const banner = await propose("Show a banner on the home page", "src/banner.ts", { objective: BANNER, risk: "medium", context: "The home page has no place for announcements today." });
  const payments = await propose("Take payments by card", "src/payments.ts", { objective: PAYMENTS, risk: "high" });
  const dropped = await propose("Remove the old importer", "src/importer.ts");
  const workflow = await propose("Run the suite on every push", "src/ci.ts");
  const search = await propose("Build the search index", "src/search.ts", { objective: SEARCH });

  const hire = await shop.desk("blog")!.teamService.propose({ action: "hire", role: "designer", reason: "the banner needs a designer's eye" });
  if (!hire.ok) throw new Error(hire.error.message);
  await command("set-focus", { project: "blog", role: "architect", focus: "Keep the modules small" });
  const signedBriefing = await shop.briefingService.propose("blog", "Marta reads only Spanish (es-MX).", "the director said so");
  if (!signedBriefing.ok) throw new Error(signedBriefing.error.message);
  await command("sign-briefing-change", { changeId: signedBriefing.value.id });
  const pendingBriefing = await shop.briefingService.propose("blog", "Marta reads Spanish and English.", "she learned English");
  if (!pendingBriefing.ok) throw new Error(pendingBriefing.error.message);
  await command("set-preference", { key: "avatar/manager", value: { hair: "short", colors: { skin: 2 } } });
  await command("pause-project", { project: "shop" });
  await record("orders and changes wait for a signature");

  await send("sign-order", { orderId: search });
  await send("send-message", { text: "Add a cart page", project: "shop" });
  for (let attempt = 0; attempt < 400 && codex.requests.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
  if (codex.requests.length === 0) throw new Error("the worker never started");
  await record("a worker is on the bench");
  await record("a paused project holds its Manager in the queue", "shop");
  finishSearch();
  await command("resume-project", { project: "shop" });

  await command("sign-order", { orderId: exported });
  await command("sign-order", { orderId: banner });
  await command("sign-order", { orderId: payments });
  await command("reassign-order", { orderId: payments, worker: "tester" });
  await command("discard-order", { orderId: dropped });
  workspace.touched = ".github/workflows/ci.yml";
  await command("sign-order", { orderId: workflow });
  workspace.touched = "src/feature.txt";
  vcs.setChecks(BLOG, shop.orders.get(exported)!.pullRequest!, "passing");
  await shop.watcher.poll();
  await record("a worker asks, one is blocked and one touched a protected path");

  await command("answer-question", { orderId: banner, answer: "green" });
  workspace.touched = ".github/workflows/ci.yml";
  await command("approve-protected-paths", { orderId: workflow });
  workspace.touched = "src/feature.txt";
  await command("answer-decision", { decisionId: ticketDoubt!.id, answer: "Keep it small" });
  await command("send-message", { text: "/plan the newsletter", project: "blog" });
  const planned = chat.messages().at(-1)!.orderId!;
  await command("sign-plan", { plan: shop.orders.get(planned)!.plan });
  vcs.setChecks(BLOG, shop.orders.get(banner)!.pullRequest!, "failing");
  await merge(exported);
  await command("record-minutes", { orderId: exported, bucket: "5-15" });
  await command("pause-shop", {});
  await record("the whole story");
});

afterAll(async () => {
  shop.stop();
  await rm(dataDir, { recursive: true, force: true });
});

describe("the state an office reports", () => {
  it("follows the contract at every moment of the story, and names nothing the contract does not", () => {
    for (const [moment, body] of moments) {
      const parsed = StateSchema.safeParse(body);
      expect(parsed.error?.issues ?? [], moment).toEqual([]);
      expect(parsed.data, moment).toEqual(body);
    }
  });

  it("was driven through every branch the story claims to cover", () => {
    const orders = moments.flatMap(([, body]) => (body as State).orders);
    const everything = at("the whole story");
    const waiting = at("a worker asks, one is blocked and one touched a protected path");

    expect(new Set(orders.map((order) => order.status))).toEqual(new Set(OrderStatusSchema.options));
    expect(new Set(orders.map((order) => order.checks))).toEqual(new Set([null, "none", "passing", "failing"]));
    expect(new Set(orders.map((order) => order.review?.verdict))).toEqual(new Set([undefined, "approved", "changes_requested"]));
    expect(everything.orders).toMatchObject([
      { status: "delivered", minutes: "5-15", pullRequest: 4, ready: true },
      { status: "in_review", context: expect.any(String), answered: [{ answer: "green" }], reviews: 2, review: { findings: [], earlier: [{ finding: "src/banner.ts: the color is hardcoded", status: "not_fixed", proof: "src/banner.ts:3 still sets #00ff00" }] } },
      { status: "on_bench", blocked: "the worker failed: the sandbox refused to start", worker: "tester" },
      { status: "discarded" },
      { status: "in_review", approvedPaths: [".github/workflows/ci.yml"] },
      { status: "in_review" },
      { status: "awaiting_signature", ticket: 7 },
      { status: "in_review" },
      { status: "signed", plan: everything.orders[7]!.id, waitingOn: [everything.orders[7]!.id] },
    ]);
    expect(waiting.orders).toMatchObject([{}, { question: "Which color should the banner be?" }, {}, {}, { protectedPaths: [".github/workflows/ci.yml"] }, {}]);
    expect(waiting.inbox.map((item) => item.kind)).toEqual(["ticket_doubt", "worker_question"]);
    expect(at("the Manager asks before it writes anything").decisions).toHaveLength(2);
    expect(at("a worker is on the bench")).toMatchObject({ orders: [{}, {}, {}, {}, {}, { status: "on_bench", working: true }], presence: { working: [{ role: "developer" }] } });
    expect(at("a paused project holds its Manager in the queue")).toMatchObject({ projectPaused: { reason: "paused by the director", by: "director" }, presence: { waiting: [{ role: "manager", position: 1 }] } });
    expect(everything).toMatchObject({
      simulated: true,
      paused: { reason: "paused by the director", by: "director" },
      teamChanges: [{ action: "hire", status: "pending" }],
      briefingChanges: [{ text: "Marta reads Spanish and English." }],
      briefing: "Marta reads only Spanish (es-MX).",
      souls: [{ role: "architect", focus: "Keep the modules small" }],
      preferences: { "avatar/manager": { hair: "short", colors: { skin: 2 } } },
      readiness: [{ level: "ok" }, { level: "warn", fix: "codex login" }],
      costs: { total: 2.22, cap: 10, tokens: { inputTokens: expect.any(Number) } },
    });
    expect(everything.answered.map((item) => item.kind).sort()).toEqual(["manager_question", "ticket_doubt", "worker_question"]);
    expect(everything.runs).toContainEqual(expect.objectContaining({ outcome: "failed", failure: { kind: "failed", message: "the sandbox refused to start" }, costUsd: 0.05 }));
    expect(everything.runs).toContainEqual(expect.objectContaining({ role: "developer", outcome: "completed", costUsd: 0.31, usage: { inputTokens: 212_000, outputTokens: 6_800, cachedInputTokens: null } }));
    expect(everything.agents.map((agent) => [agent.role, agent.spentUsd])).toEqual([["manager", null], ["developer", 2.22], ["code_reviewer", null]]);
  });

  it("notices a field the contract does not name, at the top and inside an order", () => {
    const body = at("the whole story");
    const withMood = { ...body, mood: "fine" };
    const withSecret = { ...body, orders: body.orders.map((order) => ({ ...order, projectId: "blog" })) };

    expect(StateSchema.parse(withMood)).not.toEqual(withMood);
    expect(StateSchema.parse(withSecret)).not.toEqual(withSecret);
  });

  it("notices a pauser the contract does not know, though the contract reads it as absent", () => {
    const body = at("the whole story");
    const byTheLandlord = { ...body, paused: { ...body.paused, by: "the landlord" } };

    expect(StateSchema.safeParse(byTheLandlord).success).toBe(true);
    expect(StateSchema.parse(byTheLandlord)).not.toEqual(byTheLandlord);
  });

  it("reads an answerer the contract does not know as absent, so a card claims nothing about who answered", () => {
    const body = at("the whole story");
    const answeredBy = (who: string) => ({ ...body, orders: body.orders.map((order) => ({ ...order, answered: order.answered.map((answered) => ({ ...answered, answeredBy: who })) })) });
    const answered = (state: State) => state.orders.flatMap((order) => order.answered);

    expect(answered(body)).toMatchObject([{ answer: "green" }]);
    expect(answered(body)[0]).not.toHaveProperty("answeredBy");
    expect(answered(StateSchema.parse(answeredBy("manager")))).toMatchObject([{ answeredBy: "manager" }]);
    expect(StateSchema.safeParse(answeredBy("the landlord")).success).toBe(true);
    expect(answered(StateSchema.parse(answeredBy("the landlord")))[0]?.answeredBy).toBeUndefined();
  });

  it("reads a fate the contract does not know for an earlier finding as absent, so a card shows the finding with no mark", () => {
    const body = at("the whole story");
    const withStatus = (status: string) => ({ ...body, orders: body.orders.map((order) => ({ ...order, review: order.review && { ...order.review, earlier: order.review.earlier?.map((earlier) => ({ ...earlier, status })) } })) });
    const rechecked = (state: State) => state.orders.flatMap((order) => order.review?.earlier ?? []);

    expect(rechecked(StateSchema.parse(withStatus("fixed")))).toMatchObject([{ status: "fixed" }]);
    expect(StateSchema.safeParse(withStatus("partly_fixed")).success).toBe(true);
    expect(rechecked(StateSchema.parse(withStatus("partly_fixed")))).toEqual([{ finding: "src/banner.ts: the color is hardcoded", proof: "src/banner.ts:3 still sets #00ff00" }]);
  });

  it.each<[string, (state: State) => unknown]>([
    ["an order without its status", (state) => ({ ...state, orders: state.orders.map(({ status: _status, ...order }) => order) })],
    ["an order in a status nobody knows", (state) => ({ ...state, orders: [{ ...state.orders[0], status: "archived" }] })],
    ["a cursor sent as text", (state) => ({ ...state, cursor: String(state.cursor) })],
    ["a run on an engine nobody knows", (state) => ({ ...state, runs: [{ ...state.runs[0], engine: "gemini" }] })],
    ["a cost cap left out instead of null", ({ costs: { cap: _cap, ...costs }, ...state }) => ({ ...state, costs })],
    ["a time that is not a timestamp", (state) => ({ ...state, activity: [{ ...state.activity[0], at: "yesterday" }] })],
    ["a preference that is not an object", (state) => ({ ...state, preferences: { "avatar/manager": "short hair" } })],
    ["no word on whether the office is simulated", ({ simulated: _simulated, ...state }) => state],
  ])("refuses %s", (_case, broken) => {
    expect(StateSchema.safeParse(broken(at("the whole story"))).success).toBe(false);
  });
});
