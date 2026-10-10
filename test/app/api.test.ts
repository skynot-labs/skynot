import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi } from "../../src/app/http/api";
import type { readState } from "../../src/app/http/state";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { examplePolicy } from "../governance/fixtures";

const HOST = "127.0.0.1:4747";

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
        if (id && data) received.push({ id, event: (JSON.parse(data) as { type: string }).type });
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

  it("does not hold up the rest of the shop while a client is connected", async () => {
    const stream = readEvents("/api/events", 3);

    await post("/api/commands/send-message", { text: "Export the inventory to CSV" });
    await settle();

    expect((await stream).length).toBe(3);
    expect(shop.chat.messages()).toHaveLength(2);
  });
});
