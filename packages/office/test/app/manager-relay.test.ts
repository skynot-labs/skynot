import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateSchema } from "@skynot/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readState } from "../../src/app/http/state";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { FakeEngine, type EngineRequest } from "../../src/execution";
import type { Project } from "../../src/projects";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

let dataDir: string;
let shops: Shop[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-relay-"));
  shops = [];
});

afterEach(async () => {
  shops.forEach((shop) => shop.stop());
  await rm(dataDir, { recursive: true, force: true });
});

const QUESTION = "Which color should the banner be?";
const project = (id: string): Project => ({ id, name: null, description: null, repo: `acme/${id}`, baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [".github/"] });
const team: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };

type Relay = { orderId: string; text: string; from: "director" | "manager" };
const relaying = (relay: Relay) => ({ message: "Passed on.", question: null, options: [], orders: [], consult: [], team: null, relay });

// The worker asks until its prompt carries an answer; `asks` false makes it a worker that never asks.
const worker = (asks = true) => new FakeEngine(({ prompt }) => ({ text: asks && !prompt.includes(`${QUESTION} → `) ? `QUESTION: ${QUESTION}` : "Criterion 1: covered." }));

async function openShop(manager: (request: EngineRequest) => object, developer = worker()) {
  const managerEngine = new FakeEngine((request) => ({ structured: manager(request) }));
  const shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team,
    projects: [project("blog"), project("shop")],
    engines: { claude: managerEngine, codex: developer },
    vcs: new FakeVcs(),
    workspace: new FakeWorkspace(),
  });
  shops.push(shop);
  const settle = async () => {
    for (const desk of shop.desks) await desk.manager.idle();
    await shop.flow.idle();
    for (const desk of shop.desks) await desk.manager.idle();
  };
  const sign = async (projectId = "blog") => {
    const proposed = await shop.orderService.propose(validSpec(), { projectId });
    if (!proposed.ok) throw new Error(proposed.error.message);
    await shop.orderService.sign(proposed.value.id);
    await settle();
    return proposed.value.id as string;
  };
  const say = async (text: string, projectId = "blog") => {
    await shop.desk(projectId)!.manager.handleMessage(text);
    await settle();
  };
  const recorded = async (type: string) => (await shop.log.readAfter(0)).filter((event) => event.type === type).map((event) => event.payload);
  const lastReply = (projectId = "blog") => shop.desk(projectId)!.chat.messages().at(-1)?.text;
  return { shop, managerEngine, developer, sign, say, recorded, lastReply };
}

describe("the Manager passes an answer on to a worker", () => {
  it("carries the director's answer from the chat to the worker's next run, and the log says it came through the Manager", async () => {
    const { shop, managerEngine, developer, sign, say, recorded } = await openShop(() => relaying({ orderId: "WO-0001", text: "green, like the logo", from: "director" }));
    const orderId = await sign();
    expect(shop.activity.linksFor(orderId).question).toBe(QUESTION);
    expect(shop.desk("blog")!.chat.messages().at(-1)).toMatchObject({ orderId, text: `${orderId} has a question for you: ${QUESTION} Answer it here, on its card or in the inbox.` });

    await say("green, like the logo");

    expect(managerEngine.requests.at(-1)?.prompt).toContain(`- ${orderId}: ${QUESTION}`);
    expect(developer.requests.at(-1)?.prompt).toContain(`${QUESTION} → green, like the logo`);
    expect(developer.requests.at(-1)?.prompt).not.toContain("decided by the Manager");
    expect(await recorded("delivery.question_answered")).toEqual([{ orderId, answer: "green, like the logo", answeredBy: "director_via_manager" }]);
    expect(shop.activity.recent(50, "blog").find((entry) => entry.text.includes("green"))).toMatchObject({ by: "director", text: "the director answered through the Manager: green, like the logo" });
    expect(shop.orders.get(orderId)?.status).toBe("in_review");

    const state = { ...readState(shop, "blog"), simulated: false };
    expect(state.orders[0]?.answered).toMatchObject([{ answer: "green, like the logo", answeredBy: "director_via_manager" }]);
    expect(StateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it("records the Manager's own decision as the Manager's, and tells the worker it was not the director's", async () => {
    const { shop, developer, sign, say, recorded } = await openShop(() => relaying({ orderId: "WO-0001", text: "use the theme's accent color", from: "manager" }));
    const orderId = await sign();

    await say("you decide the technical bits");

    expect(await recorded("delivery.question_answered")).toEqual([{ orderId, answer: "use the theme's accent color", answeredBy: "manager" }]);
    expect(developer.requests.at(-1)?.prompt).toContain(`${QUESTION} → use the theme's accent color (decided by the Manager, not the director)`);
    expect(shop.activity.recent(50, "blog").find((entry) => entry.text.includes("accent"))).toMatchObject({ by: "manager", text: "the Manager decided: use the theme's accent color" });
    expect(shop.activity.linksFor(orderId).answered).toMatchObject([{ answeredBy: "manager" }]);
  });

  it("leaves an answer the director gave on the card unmarked, as every answer in an older log is", async () => {
    const { shop, sign, recorded } = await openShop(() => relaying({ orderId: "WO-0001", text: "unused", from: "director" }));
    const orderId = await sign();

    await shop.flow.answerQuestion(orderId, "green");
    await shop.flow.idle();

    expect(await recorded("delivery.question_answered")).toEqual([{ orderId, answer: "green" }]);
    expect(shop.activity.linksFor(orderId).answered[0]).not.toHaveProperty("answeredBy");
    expect(shop.activity.recent(50, "blog").find((entry) => entry.text.includes("green"))).toMatchObject({ by: "director", text: "the director answered: green" });
  });

  it("sends text for an order in review as a follow-up", async () => {
    const { shop, developer, sign, say, recorded } = await openShop(() => relaying({ orderId: "WO-0001", text: "make the banner dismissible", from: "director" }), worker(false));
    const orderId = await sign();
    expect(shop.orders.get(orderId)?.status).toBe("in_review");

    await say("make the banner dismissible");

    expect(await recorded("delivery.follow_up_requested")).toEqual([{ orderId, instruction: "make the banner dismissible" }]);
    expect(developer.requests.at(-1)?.prompt).toContain("The director asks:\nmake the banner dismissible");
    expect(await recorded("delivery.question_answered")).toEqual([]);
  });

  it("cannot write to an order whose worker asked nothing and that is not in review", async () => {
    const { shop, managerEngine, developer, say, recorded, lastReply } = await openShop(() => relaying({ orderId: "WO-0001", text: "go ahead", from: "manager" }));
    const proposed = await shop.orderService.propose(validSpec(), { projectId: "blog" });
    expect(proposed).toMatchObject({ ok: true, value: { id: "WO-0001" } });

    await say("tell the worker to go ahead");

    expect(managerEngine.requests.at(-1)?.prompt).toContain('cannot write to the worker of "WO-0001"; no worker is waiting on an answer and no order is in review');
    expect(lastReply()).toContain("could not produce a valid answer");
    expect(await recorded("delivery.question_answered")).toEqual([]);
    expect(await recorded("delivery.follow_up_requested")).toEqual([]);
    expect(developer.requests).toEqual([]);
    expect(shop.orders.get("WO-0001")?.status).toBe("awaiting_signature");
  });

  it("cannot write to a worker of another project", async () => {
    const { shop, developer, sign, say, recorded, lastReply } = await openShop(() => relaying({ orderId: "WO-0001", text: "green", from: "director" }));
    const orderId = await sign("blog");
    const runsBefore = developer.requests.length;

    await say("green", "shop");

    expect(lastReply("shop")).toContain("could not produce a valid answer");
    expect(await recorded("delivery.question_answered")).toEqual([]);
    expect(developer.requests).toHaveLength(runsBefore);
    expect(shop.activity.linksFor(orderId).question).toBe(QUESTION);
  });
});
