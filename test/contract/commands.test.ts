import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RefusalSchema, commandPath, commands, simulatedCommands, type CommandName } from "@skynot/contract";
import { createApi } from "../../src/app/http/api";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { examplePolicy } from "../governance/fixtures";

const HOST = "127.0.0.1:4747";
const names = Object.keys(commands) as CommandName[];

let dataDir: string;
let shop: Shop;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-contract-"));
  shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team: { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} },
    engines: { claude: createMockManager(), codex: createMockDeveloper() },
    vcs: new FakeVcs(),
    workspace: new FakeWorkspace(),
  });
});

afterEach(async () => {
  await shop.manager.idle();
  await shop.flow.idle();
  shop.stop();
  await rm(dataDir, { recursive: true, force: true });
});

const commandRoutes = (api: Hono): string[] =>
  api.routes
    .filter((route) => route.method === "POST" && /^\/api\/(commands|dev)\//.test(route.path))
    .map((route) => route.path)
    .sort();

describe("the commands of the contract and the routes of the office", () => {
  it("are the same list in a simulated shop: no route without a schema, no schema without a route", () => {
    const api = createApi(shop, { allowedHosts: [HOST], devTools: { mergePullRequest: async () => false } });

    expect(commandRoutes(api)).toEqual(names.map(commandPath).sort());
  });

  it("leave out of a real shop exactly the commands the contract marks as simulated", () => {
    const api = createApi(shop, { allowedHosts: [HOST] });

    expect(simulatedCommands.length).toBeGreaterThan(0);
    expect(commandRoutes(api)).toEqual(
      names
        .filter((name) => !simulatedCommands.includes(name))
        .map(commandPath)
        .sort(),
    );
  });

  it("agree, payload by payload, on what is accepted and what is refused with 400", async () => {
    const api = createApi(shop, { allowedHosts: [HOST], devTools: { mergePullRequest: async () => false } });
    const project = shop.desks[0]!.project.id;
    const cases: Array<[CommandName, unknown]> = [
      ["send-message", { text: "Export the inventory to CSV" }],
      ["send-message", { text: `  ${"x".repeat(4000)}  `, project }],
      ["send-message", { text: "x".repeat(4001) }],
      ["send-message", { text: "   " }],
      ["send-message", { text: "hello", project: "Not A Project" }],
      ["answer-decision", { decisionId: "dec_unknown", answer: "Keep it small" }],
      ["answer-decision", { decisionId: "", answer: "Keep it small" }],
      ["sign-order", { orderId: "WO-0099" }],
      ["sign-order", { orderId: "WO-99" }],
      ["sign-order", null],
      ["follow-up", { orderId: "WO-0099", text: "One more thing" }],
      ["follow-up", { orderId: "WO-0099" }],
      ["reassign-order", { orderId: "WO-0099", worker: "qa" }],
      ["reassign-order", { orderId: "WO-0099", worker: "QA" }],
      ["record-minutes", { orderId: "WO-0099", bucket: "5-15" }],
      ["record-minutes", { orderId: "WO-0099", bucket: "an hour" }],
      ["stop-run", { runId: "run_0a1b-2c3d" }],
      ["stop-run", { runId: "0a1b-2c3d" }],
      ["resume-project", { project }],
      ["resume-project", { project: "x" }],
      ["set-focus", { project, role: "designer", focus: "The checkout screens" }],
      ["set-focus", { project, role: "designer", focus: "no" }],
      ["set-preference", { key: "studio/theme", value: { name: "night" } }],
      ["set-preference", { key: "studio/theme", value: null }],
      ["set-preference", { key: "elsewhere/theme", value: {} }],
      ["set-preference", { key: "studio/theme", value: "night" }],
      ["sign-team-change", { changeId: "chg_0a1b" }],
      ["sign-team-change", { changeId: "brf_0a1b" }],
      ["discard-briefing-change", { changeId: "brf_0a1b" }],
      ["discard-briefing-change", { changeId: "chg_0a1b" }],
      ["merge-pull-request", { orderId: "WO-0099" }],
      ["merge-pull-request", { orderId: 99 }],
    ];

    const outcomes = { accepted: 0, refused: 0 };
    for (const [name, payload] of cases) {
      const response = await api.request(commandPath(name), { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: JSON.stringify(payload) });
      const accepted = commands[name].safeParse(payload).success;

      expect([name, payload, response.status !== 400]).toEqual([name, payload, accepted]);
      if (!response.ok) expect([name, payload, RefusalSchema.safeParse(await response.json()).success]).toEqual([name, payload, true]);
      outcomes[accepted ? "accepted" : "refused"] += 1;
    }
    expect(outcomes).toEqual({ accepted: 15, refused: 17 });
  });
});
