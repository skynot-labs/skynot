import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createApi } from "../../src/app/http/api";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace, type Board, type BoardStage } from "../../src/delivery";
import { FakeEngine, type EngineRequest, type RoleEngine } from "../../src/execution";
import { inboxOf } from "../../src/app/inbox";
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

async function openShop(teams: Record<string, Team> = {}, vcs = new FakeVcs(), developer: RoleEngine = createMockDeveloper(), boardOf?: (project: Project) => Board | undefined) {
  const shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team: team(),
    teams,
    projects: [project("blog"), project("shop")],
    engines: { claude: createMockManager(), codex: developer },
    vcs,
    workspace: new FakeWorkspace(),
    ...(boardOf && { boardOf }),
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

describe("the director's inbox", () => {
  const asking = () => new FakeEngine(() => ({ text: "QUESTION: Which color should the banner be?" }));
  const call = (shop: Shop, path: string, body: object) =>
    createApi(shop, { allowedHosts: ["console"] }).request(path, { method: "POST", headers: { host: "console", "content-type": "application/json" }, body: JSON.stringify(body) });

  it("lists what the Manager and a worker wait on, per project, oldest first, and tells the chat about the worker's question", async () => {
    const { shop } = await openShop({}, new FakeVcs(), asking());
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    await shop.desk("shop")!.manager.handleMessage("Add a cart page");
    await shop.orderService.sign(blogOrder);
    await shop.flow.idle();

    const blog = inboxOf(shop, "blog");
    expect(blog).toMatchObject([{ kind: "worker_question", orderId: blogOrder, question: "Which color should the banner be?", from: "developer" }]);
    expect(inboxOf(shop, "shop")).toMatchObject([{ kind: "manager_question", from: "manager", orderId: null }]);
    await shop.desk("blog")!.manager.idle();
    expect(shop.desk("blog")!.chat.messages().at(-1)?.text).toContain(`${blogOrder} has a question for you: Which color should the banner be?`);
    expect(shop.desk("shop")!.chat.messages().map((message) => message.text).join("\n")).not.toContain("banner");
  });

  it("answers a worker's question through the API, and counts what waits in the project's summary", async () => {
    const { shop } = await openShop({}, new FakeVcs(), asking());
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    await shop.orderService.sign(blogOrder);
    await shop.flow.idle();
    const needs = async () => ((await (await createApi(shop, { allowedHosts: ["console"] }).request("/api/state", { headers: { host: "console" } })).json()) as { projects: Array<{ id: string; needsYou: number }> }).projects.find((entry) => entry.id === "blog")?.needsYou;
    expect(await needs()).toBe(1);

    expect((await call(shop, "/api/commands/answer-question", { orderId: blogOrder, answer: "green" })).status).toBe(200);
    await shop.flow.idle();

    expect(inboxOf(shop, "blog").map((item) => item.kind)).toEqual(["worker_question"]);
    expect((await call(shop, "/api/commands/answer-question", { orderId: "WO-0099", answer: "green" })).status).toBe(404);
    expect((await call(shop, "/api/commands/answer-question", { orderId: blogOrder, answer: "" })).status).toBe(400);
  });
});

describe("work taken from GitHub", () => {
  const ticket = (number: number, repo = "acme/blog", label = "taller:ready") => ({ repo, label, number, title: `Ticket ${number}`, body: "Please add dark mode.", url: `https://github.com/${repo}/issues/${number}` });
  const placed = () => {
    const cards: Array<[string, BoardStage]> = [];
    const board: Board = { place: async ({ url, stage }) => void cards.push([url, stage]) };
    return { cards, board };
  };

  it("hands a labelled issue to the Manager of its project once, and asks the director before it files anything", async () => {
    const vcs = new FakeVcs();
    vcs.tickets.push(ticket(7), ticket(8, "acme/blog", "bug"), ticket(9, "acme/shop"));
    const { shop } = await openShop({}, vcs);

    await shop.intake.poll();
    await shop.intake.poll();

    expect(shop.desk("blog")!.chat.messages().filter((message) => message.author === "ticket").map((message) => message.text)).toEqual(["#7 Ticket 7"]);
    expect(shop.desk("shop")!.chat.messages().filter((message) => message.author === "ticket").map((message) => message.text)).toEqual(["#9 Ticket 9"]);
    expect(shop.orders.list()).toEqual([]);
    expect(inboxOf(shop, "blog")).toMatchObject([{ kind: "ticket_doubt", ticket: 7, from: "manager" }]);
  });

  it("files the order from the ticket once the director answers, and closes the ticket with the pull request", async () => {
    const vcs = new FakeVcs();
    vcs.tickets.push(ticket(7));
    const { shop } = await openShop({}, vcs);
    await shop.intake.poll();
    const desk = shop.desk("blog")!;

    await desk.manager.answerDecision(desk.chat.openDecisions()[0]!.id, "Keep it small");
    const order = shop.orders.listFor("blog")[0]!;
    await shop.orderService.sign(order.id);
    await shop.flow.idle();

    expect(order.ticket).toBe(7);
    expect(vcs.issues[0]?.body).toContain("Taken from ticket #7");
    expect(vcs.pullRequests[0]?.body).toContain("Closes #7");
  });

  it("does not take a ticket again after a restart", async () => {
    const vcs = new FakeVcs();
    vcs.tickets.push(ticket(7));
    const first = await openShop({}, vcs);
    await first.shop.intake.poll();
    first.shop.stop();

    const { shop } = await openShop({}, vcs);
    await shop.intake.poll();

    expect(shop.desk("blog")!.chat.messages().filter((message) => message.author === "ticket")).toHaveLength(1);
  });

  it("moves the cards of the ticket and of the order as the order advances, and keeps working when the board fails", async () => {
    const vcs = new FakeVcs();
    vcs.tickets.push(ticket(7));
    const { cards, board } = placed();
    const { shop } = await openShop({}, vcs, createMockDeveloper(), (candidate) => (candidate.id === "blog" ? board : undefined));
    await shop.intake.poll();
    const desk = shop.desk("blog")!;
    await desk.manager.answerDecision(desk.chat.openDecisions()[0]!.id, "Keep it small");
    const order = shop.orders.listFor("blog")[0]!;

    await shop.orderService.sign(order.id);
    await shop.flow.idle();
    vcs.setPullRequestState("acme/blog", shop.orders.get(order.id)!.pullRequest!, "merged");
    await shop.watcher.poll();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const ticketCards = cards.filter(([url]) => url.endsWith("/issues/7")).map(([, stage]) => stage);
    expect(ticketCards).toEqual(["proposed", "in_progress", "in_review", "done"]);
    expect(cards.filter(([url]) => url.endsWith("/issues/1")).map(([, stage]) => stage)).toEqual(["in_progress", "in_review", "done"]);

    const broken: Board = { place: async () => Promise.reject(new Error("no access")) };
    const other = await openShop({}, new FakeVcs(), createMockDeveloper(), () => broken);
    const filed = await fileAnOrder(other.shop, "blog", "Add an RSS feed");
    await other.shop.orderService.sign(filed);
    await other.shop.flow.idle();
    expect(other.shop.orders.get(filed)?.status).toBe("in_review");
  });
});

describe("what the review of phase 4 found", () => {
  const issue = { repo: "acme/blog", label: "taller:ready", number: 3, title: "Dark mode", body: "Add it.", url: "https://github.com/acme/blog/issues/3" };

  it("keeps a ticket the Manager failed on, as a question for the director", async () => {
    const vcs = new FakeVcs();
    vcs.tickets.push(issue);
    const down = new FakeEngine(() => ({ kind: "engine_unavailable", message: "claude is not logged in" }));
    const shop = await createShop({ policy: examplePolicy(), dataDir, team: team(), projects: [project("blog")], engines: { claude: down, codex: createMockDeveloper() }, vcs, workspace: new FakeWorkspace() });
    shops.push(shop);

    await shop.intake.poll();
    await shop.intake.poll();

    const [item] = inboxOf(shop, "blog");
    expect(item).toMatchObject({ kind: "ticket_doubt" });
    expect(shop.desk("blog")!.chat.openDecisions()).toHaveLength(1);
  });

  it("answers 404 for a project that does not exist, instead of showing another one", async () => {
    const { shop } = await openShop();
    const response = await createApi(shop, { allowedHosts: ["console"] }).request("/api/state?project=nope", { headers: { host: "console" } });
    expect(response.status).toBe(404);
  });

  it("moves a card in the order its events happened, even when an earlier move is slower", async () => {
    const log: string[] = [];
    const board: Board = {
      place: async ({ url, stage }) => {
        if (stage === "in_progress") await new Promise((resolve) => setTimeout(resolve, 30));
        log.push(`${url.slice(-1)}:${stage}`);
      },
    };
    const { shop } = await openShop({}, new FakeVcs(), createMockDeveloper(), (candidate) => (candidate.id === "blog" ? board : undefined));
    const filed = await fileAnOrder(shop, "blog", "Add an RSS feed");
    await shop.orderService.sign(filed);
    await shop.flow.idle();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const stages = log.filter((entry) => entry.startsWith("1:")).map((entry) => entry.slice(2));
    expect(stages).toEqual(["in_progress", "in_review"]);
  });
});

describe("changing a project through the Manager", () => {
  it("proposes a briefing, waits for the signature, and uses the new one on the next turn", async () => {
    const prompts: string[] = [];
    let first = true;
    const manager = new FakeEngine((request) => {
      prompts.push(request.prompt);
      const answer = first
        ? { message: "Noted.", question: null, options: [], order: null, consult: [], team: null, briefing: { text: "Marta reads only Spanish (es-MX).", reason: "the director said so" } }
        : { message: "Fine.", question: null, options: [], order: null, consult: [], team: null, briefing: null };
      first = false;
      return { structured: answer };
    });
    const shop = await createShop({ policy: examplePolicy(), dataDir, team: team(), projects: [project("blog"), project("shop")], engines: { claude: manager }, vcs: new FakeVcs(), workspace: new FakeWorkspace(), briefing: { read: async () => "from the file" } });
    shops.push(shop);
    const call = (path: string, body: object) => createApi(shop, { allowedHosts: ["console"] }).request(path, { method: "POST", headers: { host: "console", "content-type": "application/json" }, body: JSON.stringify(body) });

    await shop.desk("blog")!.manager.handleMessage("From now on, everything is for Marta, who reads only Spanish.");
    const [pending] = shop.briefingChanges.pendingFor("blog");
    expect(pending?.text).toBe("Marta reads only Spanish (es-MX).");
    expect(shop.briefingChanges.pendingFor("shop")).toEqual([]);
    expect(shop.desk("blog")!.chat.messages().at(-1)?.text).toContain(`Briefing change ${pending!.id}`);

    await shop.desk("blog")!.manager.handleMessage("Anything else?");
    expect(prompts.at(-1)).toContain("from the file");

    expect((await call("/api/commands/sign-briefing-change", { changeId: pending!.id })).status).toBe(200);
    await shop.desk("blog")!.manager.handleMessage("And now?");
    expect(prompts.at(-1)).toContain("Marta reads only Spanish (es-MX).");
    expect(prompts.at(-1)).not.toContain("from the file");
    expect((await call("/api/commands/sign-briefing-change", { changeId: pending!.id })).status).toBe(409);
  });
});
