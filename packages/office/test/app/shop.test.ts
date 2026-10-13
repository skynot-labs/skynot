import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { readState } from "../../src/app/http/state";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import type { EngineName, EngineRequest, RoleEngine } from "../../src/execution";
import type { BriefingStore } from "../../src/projects";
import type { Team } from "../../src/team";
import { FakeEngine } from "../../src/execution";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

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

const defaultTeam: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };

function recording(engine: RoleEngine) {
  const requests: EngineRequest[] = [];
  const recorded: RoleEngine = { run: (request) => (requests.push(request), engine.run(request)), loginStatus: () => engine.loginStatus() };
  return { requests, recorded };
}

async function openShop(vcs = new FakeVcs(), team: Team = defaultTeam, engines: Partial<Record<EngineName, RoleEngine>> = { claude: createMockManager(), codex: createMockDeveloper() }, briefing?: BriefingStore) {
  const shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team,
    engines,
    vcs,
    workspace: new FakeWorkspace(),
    ...(briefing && { briefing }),
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

  it("does not report the closed pull request again after a restart", async () => {
    const first = await openShop();
    const id = await fileAnOrder(first.shop);
    await first.shop.orderService.sign(id);
    await first.shop.flow.idle();
    first.vcs.setPullRequestState(first.shop.repo, 2, "closed");
    await first.shop.watcher.poll();
    first.shop.stop();

    const { shop: restarted } = await openShop(first.vcs);
    await restarted.watcher.poll();

    expect(restarted.activity.linksFor(id).blocked).toBe("the pull request was closed without merging");
    expect(restarted.activity.recent(50).filter((entry) => entry.text.includes("closed without merging"))).toHaveLength(1);
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

describe("checks on the pull request", () => {
  it("records each change of the checks once, and an order is ready only while they are not red or running", async () => {
    const { shop, vcs } = await openShop();
    const id = await fileAnOrder(shop);
    await shop.orderService.sign(id);
    await shop.flow.idle();
    const ready = () => readState(shop).orders.find((order) => order.id === id)?.ready;
    const changes = () => shop.activity.recent(50).filter((entry) => entry.text.startsWith("checks:")).map((entry) => entry.text);

    expect(ready()).toBe(false);
    await shop.watcher.poll();
    expect(changes()).toEqual(["checks: none"]);
    expect(ready()).toBe(true);

    vcs.setChecks(shop.repo, 2, "pending");
    await shop.watcher.poll();
    await shop.watcher.poll();
    expect(changes()).toEqual(["checks: pending", "checks: none"]);
    expect(ready()).toBe(false);

    vcs.setChecks(shop.repo, 2, "failing");
    await shop.watcher.poll();
    expect(ready()).toBe(false);

    vcs.setChecks(shop.repo, 2, "passing");
    await shop.watcher.poll();
    expect(changes()).toEqual(["checks: passing", "checks: failing", "checks: pending", "checks: none"]);
    expect(ready()).toBe(true);
  });
});

describe("what the Manager is told about where the shop stands", () => {
  it("tells the Manager which pull requests wait for the director, then what was delivered and when", async () => {
    const manager = recording(createMockManager());
    const { shop, vcs } = await openShop(new FakeVcs(), defaultTeam, { claude: manager.recorded, codex: createMockDeveloper() });
    const told = async () => {
      await shop.manager.handleMessage("/ping");
      return manager.requests.at(-1)!.prompt;
    };
    const id = await fileAnOrder(shop);
    await shop.orderService.sign(id);
    await shop.flow.idle();

    expect(await told()).toContain("waiting for the director to merge:\n(none)");

    await shop.watcher.poll();
    const url = readState(shop).orders.find((order) => order.id === id)!.pullRequestUrl;
    const waiting = await told();
    expect(waiting).toContain(`waiting for the director to merge:\n- ${id} Export the inventory to CSV: ${url}`);
    expect(waiting).toContain("Delivered, newest first:\n(none)");
    expect(waiting).toMatch(/Spent by the whole shop: \$\d+\.\d\d today \(.*\), \$0\.00 yesterday/);

    vcs.setPullRequestState(shop.repo, 2, "merged");
    await shop.watcher.poll();
    const delivered = await told();
    expect(delivered).toContain(`Delivered, newest first:\n- ${id} Export the inventory to CSV, delivered ${shop.orders.get(id)!.deliveredAt}`);
    expect(delivered).toContain("waiting for the director to merge:\n(none)");
  });
});

describe("pull requests that conflict after another merge", () => {
  const twoInReview = async () => {
    const { shop, vcs } = await openShop();
    const first = await fileAnOrder(shop);
    await shop.orderService.sign(first);
    await shop.flow.idle();
    await shop.manager.handleMessage("Second idea");
    await shop.manager.answerDecision(shop.chat.openDecisions()[0]!.id, "Keep it small");
    const second = shop.chat.messages().at(-1)!.orderId!;
    await shop.orderService.sign(second);
    await shop.flow.idle();
    return { shop, vcs, first, second };
  };

  it("updates a conflicting pull request by itself, once per merge", async () => {
    const { shop, vcs, first, second } = await twoInReview();
    expect(shop.activity.linksFor(second).waitingOn).toEqual([first]);

    vcs.setPullRequestState(shop.repo, shop.orders.get(first)!.pullRequest!, "merged");
    await shop.watcher.poll();
    await shop.flow.idle();
    expect(shop.orders.get(second)?.status).toBe("in_review");

    vcs.setConflicts(shop.repo, shop.orders.get(second)!.pullRequest!, true);
    await shop.watcher.poll();
    await shop.flow.idle();
    await shop.watcher.poll();
    await shop.flow.idle();

    const followUps = shop.activity.recent(100).filter((entry) => entry.orderId === second && entry.text.startsWith("follow-up requested"));
    expect(followUps).toHaveLength(1);
  });

  it("leaves a pull request without conflicts alone", async () => {
    const { shop, vcs, first, second } = await twoInReview();
    vcs.setPullRequestState(shop.repo, shop.orders.get(first)!.pullRequest!, "merged");

    await shop.watcher.poll();
    await shop.flow.idle();
    await shop.watcher.poll();
    await shop.flow.idle();

    expect(shop.activity.recent(100).some((entry) => entry.orderId === second && entry.text.startsWith("follow-up requested"))).toBe(false);
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

  describe("the project's briefing", () => {
    const store = (text: string | null): BriefingStore => ({ read: async () => text });
    const prompts = (requests: EngineRequest[]) => requests.map((request) => request.prompt);

    it("reaches the Manager's prompt, with the rule that it never goes into an order", async () => {
      const manager = recording(createMockManager());
      const { shop } = await openShop(new FakeVcs(), defaultTeam, { claude: manager.recorded, codex: createMockDeveloper() }, store("The client hates modals."));

      await shop.manager.handleMessage("Export the inventory to CSV");

      expect(prompts(manager.requests)[0]).toContain("## Private briefing from the director\nThe client hates modals.");
      expect(manager.requests[0]?.system).toContain("Never copy or quote it in an order");
    });

    it("leaves the prompt as it was when there is no briefing, or when reading it fails", async () => {
      for (const briefing of [store(null), { read: async (): Promise<string> => Promise.reject(new Error("disk")) }]) {
        const manager = recording(createMockManager());
        const { shop } = await openShop(new FakeVcs(), defaultTeam, { claude: manager.recorded, codex: createMockDeveloper() }, briefing);

        await shop.manager.handleMessage("Export the inventory to CSV");

        expect(prompts(manager.requests)[0]).not.toContain("briefing from the director");
        expect(shop.chat.messages().at(-1)?.author).toBe("manager");
      }
    });
  });

  describe("the team file", () => {
    it("sends each role's own model to its engine", async () => {
      const manager = recording(createMockManager());
      const developer = recording(createMockDeveloper());
      const team: Team = { version: 1, roles: { manager: { engine: "claude", model: "manager-model" }, developer: { engine: "codex", model: "developer-model" } }, advisors: {}, library: {} };
      const { shop } = await openShop(new FakeVcs(), team, { claude: manager.recorded, codex: developer.recorded });

      const id = await fileAnOrder(shop);
      await shop.orderService.sign(id);
      await shop.flow.idle();

      expect(manager.requests.length).toBeGreaterThan(0);
      expect(manager.requests.every((request) => request.model === "manager-model")).toBe(true);
      expect(developer.requests).toHaveLength(1);
      expect(developer.requests[0]?.model).toBe("developer-model");
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

  describe("advisors", () => {
    const team: Team = {
      version: 1,
      roles: { manager: { engine: "claude" }, developer: { engine: "codex" } },
      advisors: {
        architect: { engine: "claude", description: "design", soul: "You are the architect." },
        reviewer: { engine: "claude", description: "scope", soul: "You are the reviewer." },
      },
      library: {},
    };

    it("consults two advisors at once and files an order that reflects their answers", async () => {
      const answers: string[] = [];
      const engine = new FakeEngine(async (request) => {
        if (!request.schema) return { text: `${request.system?.includes("architect") ? "architect" : "reviewer"}: keep it in one module` };
        answers.push(request.prompt);
        return answers.length === 1
          ? { structured: { message: "Checking.", question: null, options: [], orders: [], team: null, consult: [{ role: "architect", question: "Where?" }, { role: "reviewer", question: "Clear?" }] } }
          : { structured: { message: "Both agree.", question: null, options: [], orders: [validSpec()], consult: [], team: null } };
      });
      const { shop } = await openShop(new FakeVcs(), team, { claude: engine, codex: createMockDeveloper() });

      await shop.manager.handleMessage("Rework the export");

      expect(answers[1]).toContain("architect: keep it in one module");
      expect(answers[1]).toContain("reviewer: keep it in one module");
      expect(shop.orders.list()).toHaveLength(1);
      expect(shop.runs.list().map((run) => run.role)).toEqual(["manager", "architect", "reviewer", "manager"]);
      const logbook = shop.activity.recent(20).map((entry) => [entry.kind, entry.text]).reverse();
      expect(logbook.filter(([kind]) => kind === "advice")).toEqual([
        ["advice", "the Manager asked architect: Where?"],
        ["advice", "the Manager asked reviewer: Clear?"],
        ["advice", "architect advised: architect: keep it in one module"],
        ["advice", "reviewer advised: reviewer: keep it in one module"],
      ]);
    });
  });

  describe("hiring", () => {
    const library = { designer: { engine: "claude" as const, description: "screens", soul: "You are the designer." } };
    const team: Team = {
      version: 1,
      roles: { manager: { engine: "claude" }, developer: { engine: "codex" } },
      advisors: { architect: { engine: "claude", description: "design", soul: "You are the architect." } },
      library,
    };
    const say = (extra: object) => ({ structured: { message: "Noted.", question: null, options: [], orders: [], consult: [], team: null, ...extra } });

    it("changes nothing until the director signs, then the new advisor can be consulted", async () => {
      const prompts: string[] = [];
      const answers = [
        say({ team: { action: "hire", role: "designer", reason: "this order is mostly wording" } }),
        say({ consult: [{ role: "designer", question: "Is the wording clear?" }] }),
        say({ message: "Wording reviewed." }),
      ];
      const engine = new FakeEngine(async (request) => {
        if (!request.schema) return { text: "designer: use plain verbs" };
        prompts.push(request.prompt);
        return answers.shift()!;
      });
      const { shop } = await openShop(new FakeVcs(), team, { claude: engine, codex: createMockDeveloper() });

      await shop.manager.handleMessage("Rewrite the error messages");
      const [change] = shop.roster.pending();
      expect(shop.chat.messages().at(-1)?.text).toContain(`Team change ${change!.id}: hire designer`);
      expect(Object.keys(shop.roster.members())).toEqual(["architect"]);
      expect(prompts[0]).toContain("- designer: screens");

      await shop.teamService.sign(change!.id);
      expect(Object.keys(shop.roster.members())).toEqual(["architect", "designer"]);
      await shop.manager.handleMessage("Check the wording of the new messages");

      expect(prompts[1]).toContain("- designer: screens");
      expect(prompts[2]).toContain("designer: use plain verbs");
      expect(shop.runs.list().map((run) => run.role)).toEqual(["manager", "manager", "designer", "manager"]);
      expect(shop.activity.recent(30).filter((entry) => entry.kind === "advice").map((entry) => entry.text).reverse()).toEqual([
        "the Manager proposes to hire designer: this order is mostly wording",
        "designer joined the team",
        "the Manager asked designer: Is the wording clear?",
        "designer advised: designer: use plain verbs",
      ]);
    });

    it("keeps the signed team after a restart, from the log alone", async () => {
      const first = await openShop(new FakeVcs(), team);
      const proposed = await first.shop.teamService.propose({ action: "hire", role: "designer", reason: "wording" });
      if (!proposed.ok) throw new Error("propose failed");
      await first.shop.teamService.sign(proposed.value.id);
      first.shop.stop();

      const { shop: restarted } = await openShop(new FakeVcs(), team);

      expect(Object.keys(restarted.roster.members())).toEqual(["architect", "designer"]);
    });
  });

  describe("blocked orders", () => {
    it("tells the director in the chat when an order cannot move", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "skynot-notice-"));
      const shop = await createShop({
        policy: examplePolicy(),
        dataDir: dir,
        team: defaultTeam,
        engines: { claude: createMockManager(), codex: createMockDeveloper() },
        vcs: Object.assign(new FakeVcs(), {
          createIssue: async () => {
            throw new Error("GitHub is down");
          },
        }),
        workspace: new FakeWorkspace(),
      });
      shops.push(shop);

      const id = await fileAnOrder(shop);
      await shop.orderService.sign(id);
      await shop.flow.idle();
      await vi.waitFor(() => expect(shop.chat.messages().at(-1)?.text).toContain(`${id} is blocked:`));

      expect(shop.chat.messages().at(-1)).toMatchObject({ author: "manager", orderId: id });
      expect(shop.chat.messages().at(-1)?.text).toContain("Retry or discard it from its card.");
      await rm(dir, { recursive: true, force: true });
    });
  });

  describe("restarting", () => {
    it("blocks an order whose worker was cut off by the restart, tells the director, and lets it be retried", async () => {
      const hangs = new FakeEngine(() => new Promise(() => undefined));
      const first = await openShop(new FakeVcs(), defaultTeam, { claude: createMockManager(), codex: hangs });
      const id = await fileAnOrder(first.shop);
      await first.shop.orderService.sign(id);
      await vi.waitFor(() => expect(first.shop.runs.list().some((run) => run.role === "developer" && run.status === "running")).toBe(true));
      first.shop.stop();

      const { shop } = await openShop();

      expect(shop.orders.get(id)?.status).toBe("on_bench");
      expect(shop.activity.linksFor(id).blocked).toBe("the shop restarted while this order was being worked");
      await vi.waitFor(() => expect(shop.chat.messages().at(-1)?.text).toContain("restarted while this order was being worked"));

      await shop.flow.retry(id);
      await shop.flow.idle();

      expect(shop.orders.get(id)?.status).toBe("in_review");
      expect(shop.orders.get(id)?.pullRequest).not.toBeNull();
    });

    it("leaves alone the orders that are in review, delivered or already blocked", async () => {
      const first = await openShop();
      const id = await fileAnOrder(first.shop);
      await first.shop.orderService.sign(id);
      await first.shop.flow.idle();
      first.shop.stop();
      const before = first.shop.chat.messages().length;

      const { shop } = await openShop();

      expect(shop.orders.get(id)?.status).toBe("in_review");
      expect(shop.activity.linksFor(id).blocked).toBeNull();
      expect(shop.chat.messages()).toHaveLength(before);
    });
  });

  describe("pausing", () => {
    it("holds the Manager's turn while paused and answers when the shop resumes", async () => {
      const manager = recording(createMockManager());
      const { shop } = await openShop(new FakeVcs(), defaultTeam, { claude: manager.recorded, codex: createMockDeveloper() });
      await shop.control.pause("lunch", "director");

      const turn = shop.manager.handleMessage("Export the inventory to CSV");
      await vi.waitFor(() => expect(shop.runs.list()).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(shop.runs.list()[0]?.status).toBe("queued");
      expect(manager.requests).toHaveLength(0);
      expect(shop.activity.recent(5).map((entry) => entry.text)).toContain("the shop was paused: lunch");

      await shop.control.resume();
      await turn;

      expect(manager.requests).toHaveLength(1);
      expect(shop.chat.messages().at(-1)?.author).toBe("manager");
    });

    it("is still paused after a restart", async () => {
      const first = await openShop();
      await first.shop.control.pause("overnight", "director");
      first.shop.stop();

      const { shop } = await openShop();

      expect(shop.control.paused()).toMatchObject({ reason: "overnight" });
    });
  });
});
