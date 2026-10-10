import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createApi } from "../../src/app/http/api";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import type { EngineRequest, RoleEngine } from "../../src/execution";
import type { Project } from "../../src/projects";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

let dataDir: string;
let shops: Shop[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-multi-"));
  shops = [];
});

afterEach(async () => {
  shops.forEach((shop) => shop.stop());
  await rm(dataDir, { recursive: true, force: true });
});

const project = (id: string): Project => ({ id, repo: `acme/${id}`, baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [".github/"] });
const team = (model?: string): Team => ({ version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex", ...(model && { model }) } }, advisors: {}, library: {} });

function recording(engine: RoleEngine) {
  const requests: EngineRequest[] = [];
  return { requests, recorded: { run: (request: EngineRequest) => (requests.push(request), engine.run(request)), loginStatus: () => engine.loginStatus() } as RoleEngine };
}

async function openShop(teams: Record<string, Team> = {}, vcs = new FakeVcs(), developer: RoleEngine = createMockDeveloper()) {
  const shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team: team(),
    teams,
    projects: [project("blog"), project("shop")],
    engines: { claude: createMockManager(), codex: developer },
    vcs,
    workspace: new FakeWorkspace(),
  });
  shops.push(shop);
  return { shop, vcs };
}

async function fileAnOrder(shop: Shop, projectId: string, idea: string): Promise<string> {
  const desk = shop.desk(projectId)!;
  await desk.manager.handleMessage(idea);
  await desk.manager.answerDecision(desk.chat.openDecisions()[0]!.id, "Keep it small");
  return desk.chat.messages().at(-1)!.orderId!;
}

describe("a shop with two projects", () => {
  it("keeps one conversation, one list of orders and one team per project", async () => {
    const { shop } = await openShop();

    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    const shopOrder = await fileAnOrder(shop, "shop", "Add a cart page");

    expect([blogOrder, shopOrder]).toEqual(["WO-0001", "WO-0002"]);
    expect(shop.desk("blog")!.chat.messages().map((message) => message.text).join("\n")).toContain("RSS feed");
    expect(shop.desk("blog")!.chat.messages().map((message) => message.text).join("\n")).not.toContain("cart page");
    expect(shop.desk("shop")!.chat.messages().map((message) => message.text).join("\n")).not.toContain("RSS feed");
    expect(shop.orders.listFor("blog").map((order) => order.id)).toEqual([blogOrder]);
    expect(shop.orders.listFor("shop").map((order) => order.id)).toEqual([shopOrder]);
  });

  it("opens each order's pull request on its own project's repository, without chaining them on shared file names", async () => {
    const { shop, vcs } = await openShop();
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    const shopOrder = await fileAnOrder(shop, "shop", "Add a cart page");

    await shop.orderService.sign(blogOrder);
    await shop.orderService.sign(shopOrder);
    await shop.flow.idle();

    expect(vcs.issues.map((issue) => issue.repo).sort()).toEqual(["acme/blog", "acme/shop"]);
    expect(vcs.pullRequests.map((pullRequest) => pullRequest.repo).sort()).toEqual(["acme/blog", "acme/shop"]);
    expect([shop.orders.get(blogOrder)?.status, shop.orders.get(shopOrder)?.status]).toEqual(["in_review", "in_review"]);
  });

  it("adds up the cost of each project apart, and shows each one only its own activity", async () => {
    const { shop } = await openShop();
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    await fileAnOrder(shop, "shop", "Add a cart page");
    await shop.orderService.sign(blogOrder);
    await shop.flow.idle();

    expect(shop.runs.spentByProject("blog")).toBeCloseTo(0.31);
    expect(shop.runs.spentByProject("shop")).toBe(0);
    expect(shop.activity.recent(100, "shop").every((entry) => entry.projectId === "shop")).toBe(true);
    expect(shop.activity.recent(100, "blog").some((entry) => entry.orderId === blogOrder)).toBe(true);
    expect(shop.activity.recent(100, "shop").some((entry) => entry.orderId === blogOrder)).toBe(false);
  });

  it("runs each order's worker with the team of its own project", async () => {
    const developer = recording(createMockDeveloper());
    const { shop } = await openShop({ shop: team("shop-model") }, new FakeVcs(), developer.recorded);
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    const shopOrder = await fileAnOrder(shop, "shop", "Add a cart page");

    await shop.orderService.sign(blogOrder);
    await shop.orderService.sign(shopOrder);
    await shop.flow.idle();

    expect(developer.requests).toHaveLength(2);
    expect(new Set(developer.requests.map((request) => request.model))).toEqual(new Set([undefined, "shop-model"]));
  });

  it("gives the first project the events written before projects existed", async () => {
    const { shop } = await openShop();

    await shop.log.record([{ type: "manager.message_received", payload: { messageId: "msg_legacy", text: "an old message" } }]);

    expect(shop.desk("blog")!.chat.messages().map((message) => message.text)).toEqual(["an old message"]);
    expect(shop.desk("shop")!.chat.messages()).toEqual([]);
  });

  it("does not bring a pull request up to date because another project merged", async () => {
    const { shop, vcs } = await openShop();
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    const shopOrder = await fileAnOrder(shop, "shop", "Add a cart page");
    await shop.orderService.sign(blogOrder);
    await shop.orderService.sign(shopOrder);
    await shop.flow.idle();
    vcs.setConflicts("acme/shop", shop.orders.get(shopOrder)!.pullRequest!, true);

    vcs.setPullRequestState("acme/blog", shop.orders.get(blogOrder)!.pullRequest!, "merged");
    await shop.watcher.poll();
    await shop.flow.idle();

    expect(shop.orders.get(blogOrder)?.status).toBe("delivered");
    expect(shop.activity.recent(100, "shop").some((entry) => entry.text.startsWith("follow-up requested"))).toBe(false);
  });

  it("refuses a dependency on an order of another project", async () => {
    const { shop } = await openShop();
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");

    const result = await shop.orderService.propose(validSpec({ dependsOn: [blogOrder] }), { projectId: "shop" });

    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining("in this project") } });
  });
});

describe("the console API with two projects", () => {
  const call = (shop: Shop, path: string, body?: object) =>
    createApi(shop, { allowedHosts: ["console"] }).request(path, {
      method: body ? "POST" : "GET",
      headers: { host: "console", ...(body && { "content-type": "application/json" }) },
      ...(body && { body: JSON.stringify(body) }),
    });

  it("shows the project asked for, with what waits on the director in each", async () => {
    const { shop } = await openShop();
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    await fileAnOrder(shop, "shop", "Add a cart page");

    const state = (await (await call(shop, "/api/state?project=shop")).json()) as { project: { id: string }; orders: Array<{ id: string }>; projects: Array<{ id: string; awaitingSignature: number }> };

    expect(state.project.id).toBe("shop");
    expect(state.orders.map((order) => order.id)).toEqual(["WO-0002"]);
    expect(state.projects.map((entry) => [entry.id, entry.awaitingSignature])).toEqual([["blog", 1], ["shop", 1]]);
    expect(blogOrder).toBe("WO-0001");
    expect(((await (await call(shop, "/api/state")).json()) as { project: { id: string } }).project.id).toBe("blog");
  });

  it("sends a message to the Manager of the project named, and answers a question wherever it was asked", async () => {
    const { shop } = await openShop();

    expect((await call(shop, "/api/commands/send-message", { text: "Add a cart page", project: "shop" })).status).toBe(202);
    await shop.desk("shop")!.manager.idle();
    const question = shop.desk("shop")!.chat.openDecisions()[0]!;
    expect(shop.desk("blog")!.chat.messages()).toEqual([]);

    expect((await call(shop, "/api/commands/answer-decision", { decisionId: question.id, answer: "Keep it small" })).status).toBe(202);
    await shop.desk("shop")!.manager.idle();

    expect(shop.orders.listFor("shop")).toHaveLength(1);
    expect(shop.orders.listFor("blog")).toHaveLength(0);
    expect((await call(shop, "/api/commands/send-message", { text: "hello", project: "ghost" })).status).toBe(404);
  });
});
