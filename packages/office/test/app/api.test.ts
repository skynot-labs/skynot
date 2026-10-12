import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StreamEventSchema } from "@skynot/contract";
import { createApi } from "../../src/app/http/api";
import type { readState } from "../../src/app/http/state";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace, workerPrompt, type WorkItem } from "../../src/delivery";
import { SYSTEM_PROMPT } from "../../src/manager";
import { FakeEngine } from "../../src/execution";
import { examplePolicy } from "../governance/fixtures";

const HOST = "127.0.0.1:4747";
const item: WorkItem = { id: "WO-0001", title: "Export", objective: "Export the inventory", criteria: [], outOfScope: [], risk: "low", likelyFiles: [], card: "" };

let dataDir: string;
let shop: Shop;
let api: Hono;
let vcs: FakeVcs;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-api-"));
  vcs = new FakeVcs();
  shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team: { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: { designer: { engine: "claude", description: "screens", soul: "You design." } } },
    engines: { claude: createMockManager(), codex: createMockDeveloper() },
    vcs,
    workspace: new FakeWorkspace(),
  });
  api = createApi(shop, { allowedHosts: [HOST] });
});

afterEach(async () => {
  await shop.manager.idle();
  await shop.flow.idle();
  shop.stop();
  await rm(dataDir, { recursive: true, force: true });
});

const get = (url: string, headers: Record<string, string> = {}) => api.request(url, { headers: { host: HOST, ...headers } });

const getState = async () => (await (await get("/api/state")).json()) as ReturnType<typeof readState>;

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  api.request(url, {
    method: "POST",
    headers: { host: HOST, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

async function settle() {
  await shop.manager.idle();
  await shop.flow.idle();
}

async function fileAnOrder(): Promise<string> {
  await post("/api/commands/send-message", { text: "Export the inventory to CSV" });
  await settle();
  const [question] = shop.chat.openDecisions();
  await post("/api/commands/answer-decision", { decisionId: question!.id, answer: "Keep it small" });
  await settle();
  return shop.orders.list()[0]!.id;
}

describe("console api", () => {
  it("accepts a message, answers it in the background and exposes the chat in the state", async () => {
    const accepted = await post("/api/commands/send-message", { text: "Export the inventory to CSV" });
    expect(accepted.status).toBe(202);
    await settle();

    const state = await getState();

    expect(state.chat.map((message: { author: string }) => message.author)).toEqual(["director", "manager"]);
    expect(state.decisions).toHaveLength(1);
    expect(state.decisions[0]?.options).toEqual(["Keep it small", "Cover edge cases"]);
  });

  it("takes an idea through answer, signature, pull request, merge and minutes using only commands", async () => {
    const id = await fileAnOrder();
    let state = await getState();
    expect(state.orders[0]).toMatchObject({ id, status: "awaiting_signature" });
    expect(state.orders[0]?.card).toContain(`${id}  Export the inventory to CSV`);

    expect((await post("/api/commands/sign-order", { orderId: id })).status).toBe(200);
    await settle();
    state = await getState();
    expect(state.orders[0]).toMatchObject({ status: "in_review", pullRequest: 2 });
    expect(state.orders[0]?.issueUrl).toContain("/issues/1");

    vcs.setPullRequestState(shop.repo, 2, "merged");
    await shop.watcher.poll();

    const minutes = await post("/api/commands/record-minutes", { orderId: id, bucket: "lt5" });
    expect(await minutes.json()).toEqual({ id, status: "delivered" });
    state = await getState();
    expect(state.orders[0]).toMatchObject({ status: "delivered", minutes: "lt5" });
  });

  it("refuses a second signature with a conflict and an unknown order with not found", async () => {
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });

    expect((await post("/api/commands/sign-order", { orderId: id })).status).toBe(409);
    expect((await post("/api/commands/sign-order", { orderId: "WO-0099" })).status).toBe(404);
    await settle();
  });

  it("refuses to retry an order that is not blocked and one that does not exist", async () => {
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();

    expect((await post("/api/commands/retry-order", { orderId: id })).status).toBe(409);
    expect((await post("/api/commands/retry-order", { orderId: "WO-0099" })).status).toBe(404);
  });

  it("refuses to apply a review that asked for nothing", async () => {
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();

    expect((await post("/api/commands/apply-review", { orderId: id })).status).toBe(409);
  });

  it("refuses a follow-up on an order without a pull request, an unknown order and an empty instruction", async () => {
    const id = await fileAnOrder();

    expect((await post("/api/commands/follow-up", { orderId: id, text: "do more" })).status).toBe(409);
    expect((await post("/api/commands/follow-up", { orderId: "WO-0099", text: "do more" })).status).toBe(404);
    expect((await post("/api/commands/follow-up", { orderId: id, text: "   " })).status).toBe(400);
  });

  it("signs and discards team changes, and refuses the ones that make no sense", async () => {
    const proposed = await shop.teamService.propose({ action: "hire", role: "designer", reason: "wording heavy" });
    if (!proposed.ok) throw new Error("propose failed");
    const { id } = proposed.value;

    expect((await getState()).teamChanges).toMatchObject([{ id, action: "hire", role: "designer" }]);
    expect((await getState()).hireable).toEqual([{ name: "designer", description: "screens" }]);

    const signed = await post("/api/commands/sign-team-change", { changeId: id });
    expect(signed.status).toBe(200);
    expect(await signed.json()).toEqual({ id, status: "signed" });
    const state = await getState();
    expect(state.team.map((member) => member.role)).toEqual(["manager", "developer", "designer"]);
    expect(state.teamChanges).toEqual([]);

    expect((await post("/api/commands/sign-team-change", { changeId: id })).status).toBe(409);
    expect((await post("/api/commands/discard-team-change", { changeId: "chg_0000" })).status).toBe(404);
    expect((await post("/api/commands/discard-team-change", { changeId: "nope" })).status).toBe(400);
  });

  it("sets an advisor's focus from the console and shows its soul, and refuses one for a role with no soul", async () => {
    const hired = await shop.teamService.propose({ action: "hire", role: "designer", reason: "wording heavy" });
    if (!hired.ok) throw new Error("propose failed");
    await post("/api/commands/sign-team-change", { changeId: hired.value.id });
    const project = (await getState()).project.id;

    const set = await post("/api/commands/set-focus", { project, role: "designer", focus: "empty states" });

    expect(set.status).toBe(200);
    const state = await getState();
    expect(state.souls).toEqual([{ role: "designer", description: "screens", soul: "You design.", focus: "empty states" }]);
    expect(state.activity[0]).toMatchObject({ role: "designer", text: "designer has a new focus: empty states" });
    expect(state.instructions.find((entry) => entry.role === "designer")?.text).toMatch(/^You design\.\n\nFocus the director set for this role: empty states\n\nYou are an advisor/);
    expect((await post("/api/commands/set-focus", { project, role: "developer", focus: "tests first" })).status).toBe(409);
    expect((await post("/api/commands/set-focus", { project, role: "designer", focus: "x" })).status).toBe(400);
    expect((await post("/api/commands/set-focus", { project: "nowhere", role: "designer", focus: "empty states" })).status).toBe(404);
    expect((await getState()).souls[0]?.focus).toBe("empty states");
  });

  it("shows what each role's engine receives, with the project's own commands in the worker's rules", async () => {
    const { instructions } = await getState();
    const textOf = (role: string) => instructions.find((entry) => entry.role === role)?.text;

    expect(instructions.map((entry) => entry.role)).toEqual(["manager", "developer"]);
    expect(textOf("manager")).toBe(SYSTEM_PROMPT);
    expect(textOf("developer")).toContain(`one per call: ${shop.desks[0]!.project.verifyCommands.join(", ")}.`);
    expect(workerPrompt(item, 1, shop.desks[0]!.project)).toContain(textOf("developer"));
  });

  it("refuses to approve protected paths for an order that is not waiting for it, and for one that does not exist", async () => {
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();

    expect((await post("/api/commands/approve-protected-paths", { orderId: id })).status).toBe(409);
    expect((await post("/api/commands/approve-protected-paths", { orderId: "WO-0099" })).status).toBe(404);
  });

  it("refuses to stop an order nobody is working on and a run that is not live", async () => {
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();

    expect((await post("/api/commands/stop-order", { orderId: id })).status).toBe(409);
    expect((await post("/api/commands/stop-order", { orderId: "WO-0099" })).status).toBe(404);
    expect((await post("/api/commands/stop-run", { runId: "run_00000000" })).status).toBe(409);
    expect((await post("/api/commands/stop-run", { runId: "nope" })).status).toBe(400);
  });

  it("shows what the day and each order have cost", async () => {
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();

    const state = await getState();

    expect(state.costs.total).toBeGreaterThan(0);
    expect(state.costs.cap).toBe(shop.maxUsdPerDay ?? null);
    expect(state.orders[0]?.spentUsd).toBeCloseTo(0.31);
  });

  it("pauses and resumes the shop and shows it in the state", async () => {
    expect((await getState()).paused).toBeNull();

    expect((await post("/api/commands/pause-shop", {})).status).toBe(200);
    expect((await getState()).paused).toMatchObject({ reason: "paused by the director" });
    expect((await post("/api/commands/pause-shop", {})).status).toBe(409);

    expect((await post("/api/commands/resume-shop", {})).status).toBe(200);
    expect((await getState()).paused).toBeNull();
    expect((await post("/api/commands/resume-shop", {})).status).toBe(409);
  });

  it("rejects malformed commands without changing anything", async () => {
    expect((await post("/api/commands/send-message", { text: "   " })).status).toBe(400);
    expect((await post("/api/commands/sign-order", { orderId: "not-an-id" })).status).toBe(400);
    expect((await post("/api/commands/answer-decision", { decisionId: "dec_nope", answer: "x" })).status).toBe(404);
    expect((await post("/api/commands/record-minutes", { orderId: "WO-0001", bucket: "forever" })).status).toBe(400);
    expect(shop.chat.messages()).toEqual([]);
  });

  it("discards an order that has not started", async () => {
    const id = await fileAnOrder();

    const response = await post("/api/commands/discard-order", { orderId: id });

    expect(await response.json()).toEqual({ id, status: "discarded" });
  });

  it("shows who is working and who is waiting", async () => {
    const state = await getState();
    expect(state.presence).toEqual({ working: [], waiting: [] });
  });
});

describe("what the studio reads from the state", () => {
  it("shows the finished runs with their outcome and tokens, each role's totals and the project's tokens", async () => {
    const before = await getState();
    expect(before.project).toEqual({ id: "widgets", repo: "acme/widgets", name: null, description: null });
    expect(before.projects).toMatchObject([{ id: "widgets", name: null, description: null, paused: false }]);
    expect([before.runs, before.agents, before.costs.tokens]).toEqual([[], [], null]);

    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();
    const state = await getState();

    expect(state.runs.map((run) => run.role)).toEqual(["developer", "manager", "manager"]);
    expect(state.runs[0]).toMatchObject({ role: "developer", engine: "codex", model: "fake", turns: 1, orderId: id, outcome: "completed", failure: null, costUsd: 0.31 });
    expect(state.runs[0]?.usage).toEqual({ inputTokens: 212_000, outputTokens: 6_800, cachedInputTokens: 187_000 });
    expect(state.runs[0]?.runId).toMatch(/^run_/);
    expect(state.runs.every((run) => run.startedAt !== null && run.finishedAt !== null)).toBe(true);
    expect(state.agents).toMatchObject([
      { role: "manager", runs: 2, lastOutcome: "completed", usage: { inputTokens: 36_800 } },
      { role: "developer", runs: 1, spentUsd: 0.31, lastOutcome: "completed" },
    ]);
    expect(state.costs.tokens).toEqual({ inputTokens: 248_800, outputTokens: 7_440, cachedInputTokens: 217_200 });
  });

  it("says the developer's run cost what it reported", async () => {
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();
    const state = await getState();

    expect(state.activity.filter((entry) => entry.kind === "run").map((entry) => [entry.role, entry.text])).toContainEqual(["developer", "developer run finished, $0.31"]);
  });

  it("says who took each step of an order, and names nobody for what the service does on its own", async () => {
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();
    const steps = (await getState()).activity.filter((entry) => entry.orderId === id).map((entry) => [entry.text.split(/[:,]/)[0], entry.by]);

    expect(steps).toContainEqual(["proposed", "manager"]);
    expect(steps).toContainEqual(["signed by the director", "director"]);
    expect(steps).toContainEqual(["developer run finished", "developer"]);
    expect(steps).toContainEqual(["work started", null]);
  });

  it("carries no cost for a role whose engine reported none, in its runs, its totals and the logbook", async () => {
    shop.stop();
    const silentCodex = new FakeEngine(async () => ({ text: "Criterion 1: covered by the new test. Criterion 2: the negative case is tested." }));
    shop = await createShop({ policy: examplePolicy(), dataDir, team: shop.team, engines: { claude: createMockManager(), codex: silentCodex }, vcs, workspace: new FakeWorkspace() });
    api = createApi(shop, { allowedHosts: [HOST] });

    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();
    const state = await getState();

    expect(state.runs[0]).toMatchObject({ role: "developer", engine: "codex", outcome: "completed", costUsd: null });
    expect(state.agents.find((agent) => agent.role === "developer")).toMatchObject({ runs: 1, spentUsd: null });
    expect(state.orders[0]?.spentUsd).toBe(0);
    const logbook = state.activity.filter((entry) => entry.kind === "run").map((entry) => entry.text);
    expect(logbook).toContain("developer run finished");
    expect(logbook.some((text) => text.includes("$"))).toBe(false);
  });

  it("keeps a question in the answered list once the director answers it", async () => {
    await post("/api/commands/send-message", { text: "Export the inventory to CSV" });
    await settle();
    expect((await getState()).answered).toEqual([]);

    const [question] = shop.chat.openDecisions();
    await post("/api/commands/answer-decision", { decisionId: question!.id, answer: "Keep it small" });
    await settle();

    const state = await getState();
    expect(state.answered).toMatchObject([{ id: question!.id, kind: "manager_question", from: "manager", answer: "Keep it small", orderId: null }]);
    expect(state.inbox).toEqual([]);
  });

  it("refuses to register or describe a project when the console was given no registry", async () => {
    const registered = await post("/api/commands/register-project", { id: "blog", repo: "acme/blog", baseBranch: "main", verifyCommands: ["npm test"] });
    const described = await post("/api/commands/describe-project", { project: "widgets", name: "Widgets" });

    expect([registered.status, described.status]).toEqual([409, 409]);
    expect(await registered.json()).toEqual({ error: "projects are not managed from the console in this mode" });
    expect((await getState()).project.name).toBeNull();
  });
});

describe("an approval from a reviewer that could not read the repository", () => {
  const approval = { verdict: "approved", summary: "Matches the order.", findings: [] };

  async function reviewedOrder(sandbox: "ok" | "warn") {
    shop.stop();
    const codex = createMockDeveloper();
    const developer = codex.run.bind(codex);
    codex.run = (request) => (request.access === "read" ? new FakeEngine(() => ({ structured: approval })).run(request) : developer(request));
    shop = await createShop({
      policy: examplePolicy(),
      dataDir: await mkdtemp(path.join(tmpdir(), "skynot-api-review-")),
      team: { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" }, code_reviewer: { engine: "codex", model: "another" } }, advisors: {}, library: {} },
      engines: { claude: createMockManager(), codex },
      vcs,
      workspace: new FakeWorkspace(),
      readiness: async () => [{ check: "codex sandbox", level: sandbox, detail: "" }],
    });
    await shop.readiness.refresh();
    api = createApi(shop, { allowedHosts: [HOST] });
    const id = await fileAnOrder();
    await post("/api/commands/sign-order", { orderId: id });
    await settle();
    await shop.log.record([{ type: "delivery.checks_changed", payload: { orderId: id, state: "passing" } }]);
    return (await getState()).orders.find((order) => order.id === id)!;
  }

  it("is recorded and published as made from the diff alone, and does not make the order ready to merge", async () => {
    const order = await reviewedOrder("warn");

    expect(order.review).toMatchObject({ verdict: "approved", diffOnly: true });
    expect(order.ready).toBe(false);
    expect(vcs.comments.at(-1)?.text).toContain("Judged from the diff alone");
    expect((await getState()).activity.map((entry) => entry.text)).toContain("review round 1, from the diff alone: approved. Matches the order.");
  });

  it("makes the order ready when the reviewer could read the repository", async () => {
    const order = await reviewedOrder("ok");

    expect(order.review).toMatchObject({ verdict: "approved", diffOnly: false });
    expect(order.ready).toBe(true);
    expect(vcs.comments.at(-1)?.text).not.toContain("diff alone");
  });
});

describe("console preferences", () => {
  const set = (key: string, value: unknown) => post("/api/commands/set-preference", { key, value });

  it("sets, reads and removes a preference, and keeps the others after a restart", async () => {
    expect((await getState()).preferences).toEqual({});

    expect((await set("avatar/manager", { hair: "short", colors: { skin: 2 } })).status).toBe(200);
    expect((await set("studio/desks/blog", { x: 3, y: 4 })).status).toBe(200);
    expect((await set("studio/theme", { name: "night" })).status).toBe(200);
    expect((await set("studio/theme", null)).status).toBe(200);
    expect((await getState()).preferences).toEqual({ "avatar/manager": { hair: "short", colors: { skin: 2 } }, "studio/desks/blog": { x: 3, y: 4 } });

    shop.stop();
    shop = await createShop({ policy: examplePolicy(), dataDir, team: shop.team, engines: { claude: createMockManager(), codex: createMockDeveloper() }, vcs, workspace: new FakeWorkspace() });
    api = createApi(shop, { allowedHosts: [HOST] });

    expect((await getState()).preferences).toEqual({ "avatar/manager": { hair: "short", colors: { skin: 2 } }, "studio/desks/blog": { x: 3, y: 4 } });
  });

  it("records nothing when the value is the one already stored, or when a missing key is removed", async () => {
    await set("avatar/manager", { hair: "short", colors: { skin: 2 } });
    const cursor = shop.cursor.value;

    expect((await set("avatar/manager", { colors: { skin: 2 }, hair: "short" })).status).toBe(200);
    expect((await set("studio/theme", null)).status).toBe(200);
    expect(shop.cursor.value).toBe(cursor);

    await set("avatar/manager", { hair: "long", colors: { skin: 2 } });
    expect(shop.cursor.value).toBe(cursor + 1);
  });

  it("refuses a key outside the console's namespaces and a value that is not an object", async () => {
    for (const key of ["policy/limits", "avatar", "avatar/Manager", "studio/desks/blog/extra", "avatar/x", "../avatar/manager"]) {
      expect((await set(key, { a: 1 })).status, key).toBe(400);
    }
    for (const value of ["night", 3, ["a"], undefined]) expect((await set("studio/theme", value)).status).toBe(400);
    expect((await getState()).preferences).toEqual({});
  });

  it("refuses a value over 2048 bytes and accepts one at the limit", async () => {
    const sized = (bytes: number) => ({ a: "x".repeat(bytes - JSON.stringify({ a: "" }).length) });

    expect((await set("studio/theme", sized(2049))).status).toBe(413);
    expect((await set("studio/theme", { a: "é".repeat(1100) })).status).toBe(413);
    expect((await getState()).preferences).toEqual({});
    expect((await set("studio/theme", sized(2048))).status).toBe(200);
  });

  it("keeps at most 200 keys, and still lets the director change or remove one of them", async () => {
    for (let index = 0; index < 200; index++) await set(`studio/desk-${index}`, { index });

    const extra = await set("studio/one-too-many", { a: 1 });
    expect(extra.status).toBe(409);
    expect((await set("studio/desk-0", { index: -1 })).status).toBe(200);
    expect((await set("studio/desk-1", null)).status).toBe(200);
    expect((await set("studio/one-too-many", { a: 1 })).status).toBe(200);
    expect(Object.keys((await getState()).preferences)).toHaveLength(200);
  });
});

describe("console api safety", () => {
  it("refuses requests whose Host is not on the allowed list, which blocks DNS rebinding", async () => {
    const response = await api.request("/api/state", { headers: { host: "evil.example.com" } });
    expect(response.status).toBe(403);
  });

  it("refuses a command that arrives from another origin", async () => {
    const response = await post("/api/commands/send-message", { text: "hi" }, { origin: "https://evil.example.com" });
    expect(response.status).toBe(403);
    expect(shop.chat.messages()).toEqual([]);
  });

  it("accepts a command from the console's own origin", async () => {
    const response = await post("/api/commands/send-message", { text: "hi" }, { origin: `http://${HOST}` });
    expect(response.status).toBe(202);
    await settle();
  });

  it("refuses a command that is not JSON, so a plain HTML form cannot send one", async () => {
    const response = await api.request("/api/commands/send-message", {
      method: "POST",
      headers: { host: HOST, "content-type": "application/x-www-form-urlencoded" },
      body: "text=hi",
    });
    expect(response.status).toBe(415);
  });
});

describe("event stream", () => {
  async function readEvents(url: string, count: number, whileOpen?: () => Promise<void>) {
    const controller = new AbortController();
    const response = await api.request(url, { headers: { host: HOST }, signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const received: Array<{ id: string; event: string }> = [];
    let buffer = "";

    const trigger = whileOpen?.();
    while (received.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      for (const block of buffer.split("\n\n").slice(0, -1)) {
        const id = /^id: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!id || !data) continue;
        const event = StreamEventSchema.parse(JSON.parse(data));
        expect(String(event.sequence)).toBe(id);
        received.push({ id, event: event.type });
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
    }
    await trigger;
    controller.abort();
    await reader.cancel().catch(() => undefined);
    return received;
  }

  it("replays history after a cursor and then follows new events in order", async () => {
    await shop.log.record([{ type: "test.one", payload: {} }, { type: "test.two", payload: {} }]);

    const received = await readEvents("/api/events?after=1", 2, async () => {
      await shop.log.record([{ type: "test.three", payload: {} }]);
    });

    expect(received).toEqual([
      { id: "2", event: "test.two" },
      { id: "3", event: "test.three" },
    ]);
  });

  it("opens the stream at once when there is nothing to replay, so the client knows it is connected", async () => {
    await shop.log.record([{ type: "test.one", payload: {} }]);
    const controller = new AbortController();
    const response = await api.request(`/api/events?after=${shop.cursor.value}`, { headers: { host: HOST }, signal: controller.signal });
    const reader = response.body!.getReader();

    const first = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))]);
    controller.abort();
    await reader.cancel().catch(() => undefined);

    expect(first).not.toBeNull();
    expect(new TextDecoder().decode(first!.value)).toMatch(/^:/);
  });

  it("does not hold up the rest of the shop while a client is connected", async () => {
    const stream = readEvents("/api/events", 3);

    await post("/api/commands/send-message", { text: "Export the inventory to CSV" });
    await settle();

    expect((await stream).length).toBe(3);
    expect(shop.chat.messages()).toHaveLength(2);
  });
});
