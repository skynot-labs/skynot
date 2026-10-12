import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createApi } from "../../src/app/http/api";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace, type Board, type BoardStage } from "../../src/delivery";
import { FakeEngine, type EngineRequest, type RoleEngine } from "../../src/execution";
import { inboxOf } from "../../src/app/inbox";
import { projectsFolder, readProjects } from "../../src/app/projects";
import type { readState } from "../../src/app/http/state";
import { YamlProjectRegistry, type Project } from "../../src/projects";
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

const project = (id: string): Project => ({ id, name: null, description: null, repo: `acme/${id}`, baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [".github/"] });
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

  it("counts a signature, a team change and a blocked order as waiting, and stops counting a block once its order is delivered", async () => {
    const { shop, vcs } = await openShop({ blog: { ...team(), library: { designer: { engine: "claude", description: "screens", soul: "You design." } } } });
    const waiting = async () => {
      const response = await createApi(shop, { allowedHosts: ["console"] }).request("/api/state?project=blog", { headers: { host: "console" } });
      const state = (await response.json()) as { projects: Array<{ id: string; needsYou: number }>; orders: Array<{ id: string; blocked: string | null }> };
      return { needsYou: state.projects.find((entry) => entry.id === "blog")?.needsYou, blocked: state.orders.map((order) => order.blocked) };
    };
    const blogOrder = await fileAnOrder(shop, "blog", "Add an RSS feed");
    expect(await waiting()).toEqual({ needsYou: 1, blocked: [null] });

    const change = await shop.desk("blog")!.teamService.propose({ action: "hire", role: "designer", reason: "wording heavy" });
    expect(change.ok).toBe(true);
    expect((await waiting()).needsYou).toBe(2);

    await shop.orderService.sign(blogOrder);
    await shop.flow.idle();
    await shop.log.record([{ type: "delivery.work_blocked", payload: { orderId: blogOrder, reason: "the checks failed" } }]);
    expect(await waiting()).toEqual({ needsYou: 2, blocked: ["the checks failed"] });

    vcs.setPullRequestState("acme/blog", shop.orders.get(blogOrder)!.pullRequest!, "merged");
    await shop.watcher.poll();
    expect(shop.orders.get(blogOrder)?.status).toBe("delivered");
    expect(await waiting()).toEqual({ needsYou: 1, blocked: [null] });
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
        ? { message: "Noted.", question: null, options: [], orders: [], consult: [], team: null, briefing: { text: "Marta reads only Spanish (es-MX).", reason: "the director said so" } }
        : { message: "Fine.", question: null, options: [], orders: [], consult: [], team: null, briefing: null };
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

describe("pausing one project", () => {
  const reviewed: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" }, code_reviewer: { engine: "codex" } }, advisors: { architect: { engine: "claude", description: "design", soul: "You are the architect." } }, library: {} };
  const console = (shop: Shop) => {
    const api = createApi(shop, { allowedHosts: ["console"] });
    return {
      post: (command: string, body: object) => api.request(`/api/commands/${command}`, { method: "POST", headers: { host: "console", "content-type": "application/json" }, body: JSON.stringify(body) }),
      state: async (projectId: string) => (await (await api.request(`/api/state?project=${projectId}`, { headers: { host: "console" } })).json()) as ReturnType<typeof readState>,
    };
  };
  const liveRuns = (shop: Shop, projectId: string) => shop.runs.list().filter((run) => run.projectId === projectId && run.finishedAt === null).map((run) => [run.role, run.status]);
  async function until(condition: () => boolean) {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    if (!condition()) throw new Error("the shop never got there");
  }

  it("holds that project's next run while the other project's run starts, and shows it in the state", async () => {
    const { shop } = await openShop();
    const { post, state } = console(shop);

    expect(await (await post("pause-project", { project: "shop" })).json()).toEqual({ project: "shop", paused: true });
    const held = shop.desk("shop")!.manager.handleMessage("Add a cart page");
    await shop.desk("blog")!.manager.handleMessage("Add an RSS feed");

    expect(shop.desk("blog")!.chat.messages().map((message) => message.author)).toEqual(["director", "manager"]);
    expect(liveRuns(shop, "shop")).toEqual([["manager", "queued"]]);
    expect(await state("shop")).toMatchObject({ paused: null, projectPaused: { reason: "paused by the director", by: "director" }, presence: { working: [], waiting: [{ role: "manager" }] } });
    expect((await state("blog")).projectPaused).toBeNull();
    expect((await state("blog")).projects.map((entry) => [entry.id, entry.paused])).toEqual([["blog", false], ["shop", true]]);

    expect(await (await post("resume-project", { project: "shop" })).json()).toEqual({ project: "shop", paused: false });
    await held;
    expect(shop.desk("shop")!.chat.messages().map((message) => message.author)).toEqual(["director", "manager"]);
    expect((await state("shop")).projectPaused).toBeNull();
  });

  it("stays paused when the whole shop is paused and resumed, and comes back paused after a restart", async () => {
    const first = await openShop();
    await console(first.shop).post("pause-project", { project: "blog" });
    await console(first.shop).post("pause-shop", {});
    expect((await console(first.shop).post("resume-shop", {})).status).toBe(200);
    first.shop.stop();

    const { shop } = await openShop();
    const held = shop.desk("blog")!.manager.handleMessage("Add an RSS feed");
    await shop.desk("shop")!.manager.handleMessage("Add a cart page");

    expect((await console(shop).state("blog")).projectPaused).toMatchObject({ reason: "paused by the director" });
    expect(liveRuns(shop, "blog")).toEqual([["manager", "queued"]]);
    await console(shop).post("resume-project", { project: "blog" });
    await held;
  });

  it("refuses a project that does not exist, a second pause and a resume of a project that is not paused", async () => {
    const { shop } = await openShop();
    const { post } = console(shop);

    expect((await post("pause-project", { project: "ghost" })).status).toBe(404);
    expect((await post("resume-project", { project: "ghost" })).status).toBe(404);
    expect((await post("pause-project", {})).status).toBe(400);
    expect((await post("resume-project", { project: "blog" })).status).toBe(409);
    expect((await post("pause-project", { project: "blog" })).status).toBe(200);
    const again = await post("pause-project", { project: "blog" });
    expect([again.status, await again.json()]).toEqual([409, { error: "the project is already paused" }]);
    expect(shop.control.projectPaused("shop")).toBeNull();
  });

  it("holds every kind of run of the first project: its Manager, an advisor, a worker and the reviewer", async () => {
    let shop!: Shop;
    const pauseBlog = () => shop.control.pauseProject("blog", "test", "director");
    let turns = 0;
    const claude = new FakeEngine(async (request) => {
      if (!request.schema) return { text: "architect: one module" };
      if (++turns > 1) return { structured: { message: "Filed.", question: null, options: [], orders: [validSpec()], consult: [], team: null } };
      await pauseBlog();
      return { structured: { message: "Checking.", question: null, options: [], orders: [], team: null, consult: [{ role: "architect", question: "Where?" }] } };
    });
    const codex = new FakeEngine(async (request) => {
      if (request.schema) return { structured: { verdict: "approved", summary: "Fine.", findings: [] } };
      await pauseBlog();
      return { text: "Done.", costUsd: 0.1 };
    });
    shop = await createShop({ policy: examplePolicy(), dataDir, team: reviewed, projects: [project("blog"), project("shop")], engines: { claude, codex }, vcs: new FakeVcs(), workspace: new FakeWorkspace() });
    shops.push(shop);
    const resume = () => shop.control.resumeProject("blog");

    await pauseBlog();
    const filing = shop.desk("blog")!.manager.handleMessage("Rework the export");
    await until(() => liveRuns(shop, "blog").length === 1);
    expect([liveRuns(shop, "blog"), claude.requests.length]).toEqual([[["manager", "queued"]], 0]);

    await resume();
    await until(() => liveRuns(shop, "blog").some(([role]) => role === "architect"));
    expect([liveRuns(shop, "blog"), claude.requests.length]).toEqual([[["architect", "queued"]], 1]);

    await resume();
    await filing;
    const [order] = shop.orders.listFor("blog");
    await pauseBlog();
    await shop.orderService.sign(order!.id);
    await until(() => liveRuns(shop, "blog").length === 1);
    expect([liveRuns(shop, "blog"), codex.requests.length]).toEqual([[["developer", "queued"]], 0]);

    await resume();
    await until(() => liveRuns(shop, "blog").some(([role]) => role === "code_reviewer"));
    expect([liveRuns(shop, "blog"), codex.requests.length]).toEqual([[["code_reviewer", "queued"]], 1]);

    await resume();
    await shop.flow.idle();
    expect(shop.activity.linksFor(order!.id).review?.verdict).toBe("approved");
    expect(shop.runs.list().every((run) => run.projectId === "blog")).toBe(true);
  });

  it("shows a failed run with its kind and message", async () => {
    const down = new FakeEngine(() => ({ kind: "engine_unavailable", message: "claude is not logged in" }));
    const shop = await createShop({ policy: examplePolicy(), dataDir, team: team(), projects: [project("blog")], engines: { claude: down }, vcs: new FakeVcs(), workspace: new FakeWorkspace() });
    shops.push(shop);

    await shop.manager.handleMessage("Add an RSS feed");

    expect((await console(shop).state("blog")).runs).toMatchObject([{ role: "manager", outcome: "failed", failure: { kind: "engine_unavailable", message: "claude is not logged in" }, usage: null, model: null }]);
  });
});

describe("registering and describing a project from the console", () => {
  const yaml = (repo: string) => `version: 1\nrepo: ${repo}\nbase_branch: main\nsetup_command: null\nverify_commands:\n  - npm test # the whole suite\nprotected_paths: [".github/"]\n`;
  const policy = () => ({ ...examplePolicy(), repos: [] });
  const cms = { id: "cms", repo: "acme/cms", baseBranch: "develop", verifyCommands: ["make test"] };

  async function openManaged(folders: string[] = ["blog", "shop"]) {
    const dir = path.join(dataDir, "projects");
    for (const id of folders) {
      await mkdir(path.join(dir, id), { recursive: true });
      await writeFile(path.join(dir, id, "project.yaml"), yaml(`acme/${id}`));
    }
    const projects = folders.length > 0 ? await readProjects(policy(), false, dir) : [project("blog"), project("shop")];
    const shop = await createShop({ policy: policy(), dataDir, team: team(), projects, engines: { claude: createMockManager(), codex: createMockDeveloper() }, vcs: new FakeVcs(), workspace: new FakeWorkspace() });
    shops.push(shop);
    const api = createApi(shop, { allowedHosts: ["console"], projects: { registry: new YamlProjectRegistry(dir), folder: () => projectsFolder(dir), policyRepos: [] } });
    const post = (command: string, body: object) => api.request(`/api/commands/${command}`, { method: "POST", headers: { host: "console", "content-type": "application/json" }, body: JSON.stringify(body) });
    const state = async (projectId = "blog") => (await (await api.request(`/api/state?project=${projectId}`, { headers: { host: "console" } })).json()) as ReturnType<typeof readState>;
    return { shop, dir, post, state };
  }

  it("writes the project's folder for the next start, without bringing it into the running shop", async () => {
    const { shop, dir, post, state } = await openManaged();

    const response = await post("register-project", { ...cms, setupCommand: "npm ci", protectedPaths: ["infra/"], name: "The CMS", description: "Pages and posts" });

    expect([response.status, await response.json()]).toEqual([201, { id: "cms", restartRequired: true }]);
    expect((await readProjects(policy(), false, dir)).find((listed) => listed.id === "cms")).toEqual({ id: "cms", name: "The CMS", description: "Pages and posts", repo: "acme/cms", baseBranch: "develop", setupCommand: "npm ci", verifyCommands: ["make test"], protectedPaths: ["infra/"] });
    expect((await state()).projects.map((entry) => entry.id)).toEqual(["blog", "shop"]);
    expect(shop.desk("cms")).toBeUndefined();
    expect((await (await post("pause-project", { project: "cms" })).status)).toBe(404);
    expect(shop.activity.recent(1, "cms")[0]?.text).toBe("project registered; it starts with the next restart");
  });

  it("registers with only what is required, defaulting to no setup command and no protected paths", async () => {
    const { dir, post } = await openManaged();

    expect((await post("register-project", cms)).status).toBe(201);

    expect((await readProjects(policy(), false, dir)).find((listed) => listed.id === "cms")).toMatchObject({ name: null, description: null, setupCommand: null, protectedPaths: [] });
  });

  it("refuses a repository or an id already taken, including by a project registered a moment ago", async () => {
    const { dir, post } = await openManaged();

    const sameRepo = await post("register-project", { ...cms, repo: "Acme/Blog" });
    expect([sameRepo.status, ((await sameRepo.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("acme/blog already belongs to the project blog")]);
    expect((await post("register-project", { ...cms, id: "shop" })).status).toBe(409);

    expect((await post("register-project", cms)).status).toBe(201);
    const second = await post("register-project", { ...cms, id: "pages", repo: "ACME/cms" });
    expect([second.status, ((await second.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("acme/cms already belongs to the project cms")]);
    expect((await post("register-project", { ...cms, id: "pages", repo: "acme/pages" })).status).toBe(201);
    expect((await readProjects(policy(), false, dir)).map((listed) => listed.id)).toEqual(["blog", "cms", "pages", "shop"]);
  });

  it("refuses a project that would take the first project's place at the next start", async () => {
    const { dir, post } = await openManaged();

    const response = await post("register-project", { ...cms, id: "alpha", repo: "acme/alpha" });

    expect([response.status, ((await response.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("Choose an id that sorts after blog")]);
    expect((await readProjects(policy(), false, dir)).map((listed) => listed.id)).toEqual(["blog", "shop"]);
  });

  it("refuses to create the first folder while the shop runs from somewhere else, and says when the folder cannot be read", async () => {
    const { dir, post } = await openManaged([]);

    const response = await post("register-project", cms);
    expect([response.status, ((await response.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("blog, shop would vanish")]);
    expect((await projectsFolder(dir)).holdsProjects).toBe(false);

    await mkdir(path.join(dir, "broken"), { recursive: true });
    await writeFile(path.join(dir, "broken", "project.yaml"), "version: 7\n");
    const unreadable = await post("register-project", cms);
    expect([unreadable.status, ((await unreadable.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("projects/broken/project.yaml is invalid")]);
  });

  it("rejects a malformed registration without writing anything", async () => {
    const { dir, post } = await openManaged();

    for (const body of [{ ...cms, id: "CMS" }, { ...cms, repo: "cms" }, { ...cms, verifyCommands: [] }, { ...cms, baseBranch: "" }, { ...cms, name: "x".repeat(61) }, { id: "cms" }]) {
      expect((await post("register-project", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await readProjects(policy(), false, dir)).map((listed) => listed.id)).toEqual(["blog", "shop"]);
  });

  it("shows a new name and description at once and writes them to the project's file, keeping the rest of it", async () => {
    const { shop, dir, post, state } = await openManaged();

    const response = await post("describe-project", { project: "shop", name: "The Shop", description: "Carts and checkout" });

    expect([response.status, await response.json()]).toEqual([200, { id: "shop", name: "The Shop", description: "Carts and checkout" }]);
    expect((await state("shop")).project).toEqual({ id: "shop", repo: "acme/shop", name: "The Shop", description: "Carts and checkout" });
    expect((await state("blog")).projects.map((entry) => [entry.id, entry.name])).toEqual([["blog", null], ["shop", "The Shop"]]);
    const source = await readFile(path.join(dir, "shop", "project.yaml"), "utf8");
    expect(source).toContain("name: The Shop\ndescription: Carts and checkout\n");
    expect(source).toContain("  - npm test # the whole suite");
    expect(shop.activity.recent(1, "shop")[0]?.text).toBe("project name and description changed");

    expect((await post("describe-project", { project: "shop", name: null })).status).toBe(200);
    expect((await state("shop")).project).toMatchObject({ name: null, description: "Carts and checkout" });
    expect((await readProjects(policy(), false, dir)).find((listed) => listed.id === "shop")).toMatchObject({ name: null, description: "Carts and checkout" });
  });

  it("refuses to describe a project that does not exist and a name that is too long", async () => {
    const { post, state } = await openManaged();
    expect((await post("describe-project", { project: "ghost", name: "Ghost" })).status).toBe(404);
    expect((await post("describe-project", { name: "No project" })).status).toBe(400);
    const tooLong = await post("describe-project", { project: "blog", name: "x".repeat(61) });
    expect([tooLong.status, ((await tooLong.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("at most 60 characters")]);
    expect((await state()).project.name).toBeNull();
  });

  it("refuses to describe a project that has no folder of its own", async () => {
    const { post, state } = await openManaged([]);

    const response = await post("describe-project", { project: "blog", name: "The Blog" });

    expect([response.status, ((await response.json()) as { error: string }).error]).toEqual([409, expect.stringContaining("cannot be described")]);
    expect((await state()).project.name).toBeNull();
  });
});
