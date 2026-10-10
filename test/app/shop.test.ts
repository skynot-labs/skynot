import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import type { EngineName, EngineRequest, RoleEngine } from "../../src/execution";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";

let dataDir: string;
let shops: Shop[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-shop-"));
  shops = [];
});

afterEach(async () => {
  shops.forEach((shop) => shop.stop());
  await rm(dataDir, { recursive: true, force: true });
});

const defaultTeam: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } } };

function recording(engine: RoleEngine) {
  const requests: EngineRequest[] = [];
  const recorded: RoleEngine = { run: (request) => (requests.push(request), engine.run(request)), loginStatus: () => engine.loginStatus() };
  return { requests, recorded };
}

async function openShop(vcs = new FakeVcs(), team: Team = defaultTeam, engines: Partial<Record<EngineName, RoleEngine>> = { claude: createMockManager(), codex: createMockDeveloper() }) {
  const shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team,
    engines,
    vcs,
    workspace: new FakeWorkspace(),
  });
  shops.push(shop);
  return { shop, vcs };
}

async function fileAnOrder(shop: Shop): Promise<string> {
  await shop.manager.handleMessage("Export the inventory to CSV");
  const [question] = shop.chat.openDecisions();
  await shop.manager.answerDecision(question!.id, "Keep it small");
  return shop.chat.messages().at(-1)!.orderId!;
}

describe("the shop, end to end with simulated engines", () => {
  it("takes an idea from a chat message to a delivered order with its minutes recorded", async () => {
    const { shop, vcs } = await openShop();

    const id = await fileAnOrder(shop);
    expect(shop.orders.get(id)).toMatchObject({ status: "awaiting_signature" });
    expect(shop.chat.messages().at(-1)?.text).toContain(`${id}  Export the inventory to CSV`);

    await shop.orderService.sign(id);
    await shop.flow.idle();
    expect(shop.orders.get(id)).toMatchObject({ status: "in_review", pullRequest: 2 });
    expect(vcs.pullRequests).toHaveLength(1);

    vcs.setPullRequestState(shop.repo, 2, "merged");
    await shop.watcher.poll();
    expect(shop.orders.get(id)?.status).toBe("delivered");

    await shop.orderService.recordMinutes(id, "5-15");
    expect(shop.orders.get(id)?.minutes).toBe("5-15");
  });

  it("keeps the whole picture after a restart, from the event log alone", async () => {
    const first = await openShop();
    const id = await fileAnOrder(first.shop);
    await first.shop.orderService.sign(id);
    await first.shop.flow.idle();
    first.shop.stop();

    const { shop: restarted } = await openShop();

    expect(restarted.orders.get(id)).toMatchObject({ status: "in_review", pullRequest: 2 });
    expect(restarted.chat.messages().length).toBe(first.shop.chat.messages().length);
    expect(restarted.runs.list().map((run) => run.role)).toEqual(["manager", "manager", "developer"]);
    expect(restarted.activity.linksFor(id).pullRequestUrl).toContain("/pull/2");
  });

  it("does not deliver while the pull request is still open", async () => {
    const { shop } = await openShop();
    const id = await fileAnOrder(shop);
    await shop.orderService.sign(id);
    await shop.flow.idle();

    await shop.watcher.poll();

    expect(shop.orders.get(id)?.status).toBe("in_review");
  });

  it("reports a pull request closed without merge once, and leaves the order in review", async () => {
    const { shop, vcs } = await openShop();
    const id = await fileAnOrder(shop);
    await shop.orderService.sign(id);
    await shop.flow.idle();
    vcs.setPullRequestState(shop.repo, 2, "closed");

    await shop.watcher.poll();
    await shop.watcher.poll();

    expect(shop.orders.get(id)?.status).toBe("in_review");
    expect(shop.activity.linksFor(id).blocked).toBe("the pull request was closed without merging");
    expect(shop.activity.recent(50).filter((entry) => entry.text.includes("closed without merging"))).toHaveLength(1);
  });

  it("keeps polling after GitHub fails once", async () => {
    const { shop, vcs } = await openShop();
    const id = await fileAnOrder(shop);
    await shop.orderService.sign(id);
    await shop.flow.idle();
    const realState = vcs.pullRequestState.bind(vcs);
    vcs.pullRequestState = async () => {
      throw new Error("network down");
    };
    await shop.watcher.poll();

    vcs.pullRequestState = realState;
    vcs.setPullRequestState(shop.repo, 2, "merged");
    await shop.watcher.poll();

    expect(shop.orders.get(id)?.status).toBe("delivered");
  });
});

describe("activity", () => {
  it("lists what happened to an order, newest first, with the links GitHub gave", async () => {
    const { shop } = await openShop();
    const id = await fileAnOrder(shop);
    await shop.orderService.sign(id);
    await shop.flow.idle();

    const texts = shop.activity.recent(20).map((entry) => entry.text);

    expect(texts[0]).toContain("in review, pull request #2");
    expect(texts).toEqual(expect.arrayContaining(["signed by the director", "issue #1 opened", "work started"]));
    expect(shop.activity.linksFor(id)).toMatchObject({ issueUrl: expect.stringContaining("/issues/1"), blocked: null });
  });

  it("shows why work is blocked and clears it when work starts again", async () => {
    const { shop } = await openShop();
    const id = await fileAnOrder(shop);
    await shop.log.record([{ type: "delivery.work_blocked", payload: { orderId: id, reason: "setup failed" } }]);
    expect(shop.activity.linksFor(id).blocked).toBe("setup failed");

    await shop.log.record([{ type: "orders.work_started", payload: { orderId: id } }]);

    expect(shop.activity.linksFor(id).blocked).toBeNull();
  });

  describe("the team file", () => {
    it("sends each role's model to its engine, and none when the role names none", async () => {
      const manager = recording(createMockManager());
      const developer = recording(createMockDeveloper());
      const team: Team = { version: 1, roles: { manager: { engine: "claude", model: "manager-model" }, developer: { engine: "codex" } } };
      const { shop } = await openShop(new FakeVcs(), team, { claude: manager.recorded, codex: developer.recorded });

      const id = await fileAnOrder(shop);
      await shop.orderService.sign(id);
      await shop.flow.idle();

      expect(manager.requests.length).toBeGreaterThan(0);
      expect(manager.requests.every((request) => request.model === "manager-model")).toBe(true);
      expect(developer.requests).toHaveLength(1);
      expect("model" in developer.requests[0]!).toBe(false);
    });

    it("runs the developer on the engine the team names, not on the manager's", async () => {
      const claude = recording(createMockManager());
      const codex = recording(createMockDeveloper());
      const { shop } = await openShop(new FakeVcs(), defaultTeam, { claude: claude.recorded, codex: codex.recorded });

      const id = await fileAnOrder(shop);
      await shop.orderService.sign(id);
      await shop.flow.idle();

      expect(shop.runs.list().map((run) => [run.role, run.engine])).toEqual([["manager", "claude"], ["manager", "claude"], ["developer", "codex"]]);
    });
  });
});
