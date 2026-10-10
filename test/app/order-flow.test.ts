import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityProjection } from "../../src/app/activity";
import { createDeliveryRules } from "../../src/app/delivery-rules";
import { OrderFlow } from "../../src/app/order-flow";
import { createWorkerRunner } from "../../src/app/worker-runner";
import { FakeVcs, GitWorkspace, Implementer, IssueFiler } from "../../src/delivery";
import { FakeEngine, RunScheduler, RunsProjection } from "../../src/execution";
import { ActionBudget, ActionCounts, type Policy } from "../../src/governance";
import { fixedClock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { OrderService, OrdersProjection } from "../../src/orders";
import { addFiles, cloneFrom, createSandbox, git, type Sandbox } from "../delivery/git-fixture";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

let sandbox: Sandbox;

beforeEach(async () => {
  sandbox = await createSandbox();
});

afterEach(() => sandbox.cleanup());

function shopPolicy(limits: Partial<Policy["limits"]> = {}): Policy {
  const policy = examplePolicy();
  return {
    ...policy,
    repos: [
      {
        name: "acme/widgets",
        base_branch: "main",
        setup_command: null,
        verify_commands: ["test -f src/feature.txt"],
        protected_paths: [".github/"],
      },
    ],
    limits: { ...policy.limits, ...limits },
  };
}

type WorkerWork = (dir: string) => Promise<void>;

async function createShop(work: WorkerWork, options: { policy?: Policy; repo?: string } = {}) {
  const policy = options.policy ?? shopPolicy();
  const clock = fixedClock(new Date("2026-10-09T12:00:00.000Z"));
  const log = new EventLog(new InMemoryEventStore(), clock);
  const orders = new OrdersProjection();
  const runs = new RunsProjection();
  const counts = new ActionCounts();
  const activity = new ActivityProjection();
  for (const projection of [orders, runs, counts, activity]) await attachProjection(log, projection);

  const engine = new FakeEngine(async (request) => {
    await work(request.cwd);
    return { text: "evidence: test -f src/feature.txt" };
  });
  const scheduler = new RunScheduler({ claude: engine }, log, policy.limits.max_parallel);
  const rules = createDeliveryRules(policy, new ActionBudget(policy, log, counts, clock));
  const vcs = new FakeVcs();
  const workspace = new GitWorkspace({ root: path.join(sandbox.root, "shop"), clone: cloneFrom(sandbox.origin) });
  const worker = createWorkerRunner(scheduler, { engine: "claude" });
  const orderService = new OrderService(log, orders);

  const flow = new OrderFlow({
    log,
    orders: orderService,
    filer: new IssueFiler({ log, vcs, rules }),
    implementer: new Implementer({ log, vcs, workspace, worker, rules }),
    repo: options.repo ?? "acme/widgets",
    findOrder: (id) => orders.get(id),
    listOrders: () => orders.list(),
    progressOf: (id) => activity.linksFor(id),
  });
  flow.start();

  const eventTypes = async () => (await log.readAfter(0)).map((event) => event.type).filter((type) => type.startsWith("delivery."));
  return { flow, orderService, orders, runs, vcs, engine, eventTypes, log, activity };
}

const createsFeature: WorkerWork = (dir) => addFiles(dir, { "src/feature.txt": "feature\n" });

async function proposeAndSign(shop: Awaited<ReturnType<typeof createShop>>) {
  const proposed = await shop.orderService.propose(validSpec());
  if (!proposed.ok) throw new Error(proposed.error.message);
  await shop.orderService.sign(proposed.value.id);
  await shop.flow.idle();
  return proposed.value.id;
}

describe("order flow", () => {
  it("takes a signed order to an open pull request without further input", async () => {
    const shop = await createShop(createsFeature);

    const id = await proposeAndSign(shop);

    expect(shop.orders.get(id)).toMatchObject({ status: "in_review", pullRequest: 2 });
    expect(shop.vcs.issues).toMatchObject([{ number: 1, title: "WO-0001 Export the inventory to CSV", labels: ["taller:implement"] }]);
    expect(shop.vcs.pullRequests).toMatchObject([{ number: 2, head: "taller/wo-0001", base: "main" }]);
    expect(shop.vcs.pullRequests[0]?.body).toContain("Closes #1");
    expect(await shop.eventTypes()).toEqual(["delivery.issue_opened", "delivery.pull_request_opened"]);
  });

  it("runs the worker as a recorded developer run tied to the order", async () => {
    const shop = await createShop(createsFeature);

    await proposeAndSign(shop);

    expect(shop.runs.list()).toMatchObject([{ role: "developer", orderId: "WO-0001", access: "write", status: "completed" }]);
    expect(shop.engine.requests[0]?.allowedCommands).toContain("test -f src/feature.txt");
  });

  it("leaves the order on the bench and says why when the work is blocked", async () => {
    const shop = await createShop(async () => undefined);

    const id = await proposeAndSign(shop);

    expect(shop.orders.get(id)?.status).toBe("on_bench");
    expect(shop.vcs.pullRequests).toEqual([]);
    expect(await shop.eventTypes()).toEqual(["delivery.issue_opened", "delivery.work_blocked"]);
  });

  it("blocks work that touches a protected path", async () => {
    const shop = await createShop((dir) => addFiles(dir, { "src/feature.txt": "x", ".github/workflows/ci.yml": "on: push" }));

    await proposeAndSign(shop);

    expect(shop.vcs.pullRequests).toEqual([]);
    expect(await shop.eventTypes()).toContain("delivery.work_blocked");
  });

  it("does not start the work twice when the order is signed twice", async () => {
    const shop = await createShop(createsFeature);
    const proposed = await shop.orderService.propose(validSpec());
    if (!proposed.ok) throw new Error("propose failed");

    await Promise.all([shop.orderService.sign(proposed.value.id), shop.orderService.sign(proposed.value.id)]);
    await shop.flow.idle();

    expect(shop.engine.requests).toHaveLength(1);
    expect(shop.vcs.pullRequests).toHaveLength(1);
  });

  it("stops before the pull request when the order's action budget is spent", async () => {
    const shop = await createShop(createsFeature, { policy: shopPolicy({ actions_per_order_per_day: 2 }) });

    const id = await proposeAndSign(shop);

    expect(shop.vcs.issues).toHaveLength(1);
    expect(shop.vcs.pullRequests).toEqual([]);
    expect(shop.orders.get(id)?.status).toBe("on_bench");
  });

  it("leaves the order signed and creates nothing when the repository is not in the policy", async () => {
    const shop = await createShop(createsFeature, { repo: "acme/other" });

    const id = await proposeAndSign(shop);

    expect(shop.orders.get(id)?.status).toBe("signed");
    expect(shop.vcs.issues).toEqual([]);
    expect(await shop.eventTypes()).toEqual(["delivery.work_blocked"]);
  });

  it("works on two signed orders at the same time and opens a pull request for each", async () => {
    const shop = await createShop(createsFeature);
    const first = await shop.orderService.propose(validSpec());
    const second = await shop.orderService.propose(validSpec({ title: "Second order" }));
    if (!first.ok || !second.ok) throw new Error("propose failed");

    await shop.orderService.sign(first.value.id);
    await shop.orderService.sign(second.value.id);
    await shop.flow.idle();

    expect(shop.vcs.pullRequests.map((pullRequest) => pullRequest.head).sort()).toEqual(["taller/wo-0001", "taller/wo-0002"]);
    expect(shop.orders.list().map((order) => order.status)).toEqual(["in_review", "in_review"]);
  });

  describe("retry", () => {
    const failsOnce = () => {
      let attempts = 0;
      return async (dir: string) => {
        if (++attempts > 1) await addFiles(dir, { "src/feature.txt": "feature\n" });
      };
    };

    it("picks a blocked order up where it stopped, reusing its issue", async () => {
      const shop = await createShop(failsOnce());
      const id = await proposeAndSign(shop);
      expect(shop.orders.get(id)?.status).toBe("on_bench");

      const retried = await shop.flow.retry(id);
      await shop.flow.idle();

      expect(retried.ok).toBe(true);
      expect(shop.orders.get(id)).toMatchObject({ status: "in_review", pullRequest: 2 });
      expect(shop.vcs.issues).toHaveLength(1);
      expect(shop.vcs.pullRequests).toMatchObject([{ number: 2, head: "taller/wo-0001" }]);
      expect(await shop.eventTypes()).toEqual([
        "delivery.issue_opened",
        "delivery.work_blocked",
        "delivery.work_retried",
        "delivery.pull_request_opened",
      ]);
    });

    it("keeps the order blocked when the retry fails again", async () => {
      const shop = await createShop(async () => undefined);
      const id = await proposeAndSign(shop);

      await shop.flow.retry(id);
      await shop.flow.idle();

      expect(shop.orders.get(id)?.status).toBe("on_bench");
      expect(shop.vcs.issues).toHaveLength(1);
      expect((await shop.eventTypes()).filter((type) => type === "delivery.work_blocked")).toHaveLength(2);
    });

    it("refuses an order that is not blocked", async () => {
      const shop = await createShop(createsFeature);
      const id = await proposeAndSign(shop);

      const retried = await shop.flow.retry(id);

      expect(retried).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
      expect(shop.engine.requests).toHaveLength(1);
    });

    it("refuses an order that does not exist", async () => {
      const shop = await createShop(createsFeature);

      expect(await shop.flow.retry("WO-0099")).toMatchObject({ ok: false, error: { kind: "not_found" } });
    });

    it("starts only one run when the retry is requested twice at once", async () => {
      const shop = await createShop(failsOnce());
      const id = await proposeAndSign(shop);

      await Promise.all([shop.flow.retry(id), shop.flow.retry(id)]);
      await shop.flow.idle();

      expect(shop.engine.requests).toHaveLength(2);
      expect(shop.vcs.pullRequests).toHaveLength(1);
    });
  });

  describe("follow-up", () => {
    async function moveMain(files: Record<string, string>) {
      const upstream = path.join(sandbox.root, "upstream");
      await git(sandbox.root, "clone", "--quiet", sandbox.origin, upstream);
      await addFiles(upstream, files);
      await git(upstream, "add", "-A");
      await git(upstream, "commit", "-m", "main moved");
      await git(upstream, "push", "origin", "main");
    }

    const branchFile = async (name: string) => (await git(sandbox.origin, "show", `taller/wo-0001:${name}`)).trimEnd();

    // the first run creates the feature; later runs apply `followUpWork`
    const afterFirst = (followUpWork: WorkerWork): WorkerWork => {
      let runs = 0;
      return (dir) => (++runs === 1 ? createsFeature(dir) : followUpWork(dir));
    };

    it("applies the director's instruction to the same pull request", async () => {
      const shop = await createShop(afterFirst((dir) => addFiles(dir, { "src/extra.txt": "extra\n" })));
      const id = await proposeAndSign(shop);

      const sent = await shop.flow.followUp(id, "also add an extra file");
      await shop.flow.idle();

      expect(sent.ok).toBe(true);
      expect(shop.engine.requests[1]?.prompt).toContain("also add an extra file");
      expect(shop.orders.get(id)).toMatchObject({ status: "in_review", pullRequest: 2 });
      expect(shop.vcs.pullRequests).toHaveLength(1);
      expect(await branchFile("src/extra.txt")).toBe("extra");
      expect(await shop.eventTypes()).toEqual([
        "delivery.issue_opened",
        "delivery.pull_request_opened",
        "delivery.follow_up_requested",
        "delivery.pull_request_updated",
      ]);
    });

    it("resolves a conflict with the base branch and keeps the history linear", async () => {
      const shop = await createShop(afterFirst((dir) => addFiles(dir, { "src/feature.txt": "feature\nother\n" })));
      const id = await proposeAndSign(shop);
      await moveMain({ "src/feature.txt": "other\n" });

      await shop.flow.followUp(id, "resolve the conflicts with main");
      await shop.flow.idle();

      expect(shop.engine.requests[1]?.prompt).toContain("resolve the conflicts with main");
      expect(await branchFile("src/feature.txt")).toBe("feature\nother");
      await git(sandbox.origin, "merge-base", "--is-ancestor", "main", "taller/wo-0001");
      expect((await git(sandbox.origin, "rev-list", "--count", "main..taller/wo-0001")).trim()).toBe("1");
      expect((await git(sandbox.origin, "rev-list", "--merges", "--count", "taller/wo-0001")).trim()).toBe("0");
    });

    it("blocks and leaves the pull request untouched when conflict markers remain", async () => {
      const shop = await createShop(afterFirst(async () => undefined));
      const id = await proposeAndSign(shop);
      await moveMain({ "src/feature.txt": "other\n" });
      const before = (await git(sandbox.origin, "rev-parse", "taller/wo-0001")).trim();

      await shop.flow.followUp(id, "resolve the conflicts with main");
      await shop.flow.idle();

      expect(shop.orders.get(id)?.status).toBe("in_review");
      expect(await shop.eventTypes()).toContain("delivery.work_blocked");
      expect(await shop.eventTypes()).not.toContain("delivery.pull_request_updated");
      expect((await git(sandbox.origin, "rev-parse", "taller/wo-0001")).trim()).toBe(before);
    });

    it("blocks a follow-up that touches a protected path", async () => {
      const shop = await createShop(afterFirst((dir) => addFiles(dir, { ".github/workflows/ci.yml": "on: push" })));
      const id = await proposeAndSign(shop);

      await shop.flow.followUp(id, "add a workflow");
      await shop.flow.idle();

      expect(await shop.eventTypes()).toContain("delivery.work_blocked");
      expect(await shop.eventTypes()).not.toContain("delivery.pull_request_updated");
    });

    it("refuses an order without an open pull request and one that does not exist", async () => {
      const shop = await createShop(createsFeature);
      const proposed = await shop.orderService.propose(validSpec());
      if (!proposed.ok) throw new Error("propose failed");

      expect(await shop.flow.followUp(proposed.value.id, "do more")).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
      expect(await shop.flow.followUp("WO-0099", "do more")).toMatchObject({ ok: false, error: { kind: "not_found" } });
      expect(shop.engine.requests).toHaveLength(0);
    });

    it("starts only one run when the follow-up is sent twice at once", async () => {
      const shop = await createShop(afterFirst((dir) => addFiles(dir, { "src/extra.txt": "extra\n" })));
      const id = await proposeAndSign(shop);

      await Promise.all([shop.flow.followUp(id, "add extra"), shop.flow.followUp(id, "add extra")]);
      await shop.flow.idle();

      expect(shop.engine.requests).toHaveLength(2);
    });
  });

  describe("discard", () => {
    it("drops an order that is blocked on the bench", async () => {
      const shop = await createShop(async () => undefined);
      const id = await proposeAndSign(shop);
      expect(shop.orders.get(id)?.status).toBe("on_bench");

      const dropped = await shop.flow.discard(id);

      expect(dropped).toMatchObject({ ok: true, value: { status: "discarded" } });
    });

    it("refuses to drop an order while a worker is still on it", async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const shop = await createShop(async (dir) => {
        await gate;
        await createsFeature(dir);
      });
      const proposed = await shop.orderService.propose(validSpec());
      if (!proposed.ok) throw new Error("propose failed");
      await shop.orderService.sign(proposed.value.id);
      await vi.waitFor(() => expect(shop.engine.requests).toHaveLength(1));

      const refused = await shop.flow.discard(proposed.value.id);
      release();
      await shop.flow.idle();

      expect(refused).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
      expect(shop.orders.get(proposed.value.id)?.status).toBe("in_review");
    });

    it("still discards an order that was only signed", async () => {
      const shop = await createShop(createsFeature, { repo: "acme/other" });
      const id = await proposeAndSign(shop);

      expect(await shop.flow.discard(id)).toMatchObject({ ok: true, value: { status: "discarded" } });
    });
  });

  describe("protected paths", () => {
    const touching = (...files: string[]): WorkerWork => (dir) => addFiles(dir, { "src/feature.txt": "feature\n", ...Object.fromEntries(files.map((file) => [file, "x\n"])) });
    const pathsOf = async (shop: Awaited<ReturnType<typeof createShop>>) =>
      (await shop.log.readAfter(0)).filter((event) => event.type === "delivery.protected_paths_found").map((event) => (event.payload as { paths: string[] }).paths);

    it("records which protected files the worker touched when it blocks", async () => {
      const shop = await createShop(touching(".github/workflows/lint.yml"));

      const id = await proposeAndSign(shop);

      expect(shop.orders.get(id)?.status).toBe("on_bench");
      expect(await pathsOf(shop)).toEqual([[".github/workflows/lint.yml"]]);
      expect(shop.activity.linksFor(id)).toMatchObject({ protectedPaths: [".github/workflows/lint.yml"], approvedPaths: [] });
    });

    it("lets the next run touch exactly the files the director approved", async () => {
      const shop = await createShop(touching(".github/workflows/lint.yml"));
      const id = await proposeAndSign(shop);

      const approved = await shop.flow.approveProtected(id);
      await shop.flow.idle();

      expect(approved.ok).toBe(true);
      expect(shop.orders.get(id)).toMatchObject({ status: "in_review", pullRequest: 2 });
      expect(shop.activity.linksFor(id)).toMatchObject({ protectedPaths: [], approvedPaths: [".github/workflows/lint.yml"], blocked: null });
      expect(await shop.eventTypes()).toEqual([
        "delivery.issue_opened",
        "delivery.protected_paths_found",
        "delivery.work_blocked",
        "delivery.protected_paths_approved",
        "delivery.pull_request_opened",
      ]);
    });

    it("blocks again on a protected file nobody approved, and keeps the earlier approval", async () => {
      let runs = 0;
      const shop = await createShop((dir) => touching(".github/workflows/lint.yml", ...(++runs > 1 ? [".github/CODEOWNERS"] : []))(dir));
      const id = await proposeAndSign(shop);

      await shop.flow.approveProtected(id);
      await shop.flow.idle();

      expect(shop.orders.get(id)?.status).toBe("on_bench");
      expect(await pathsOf(shop)).toEqual([[".github/workflows/lint.yml"], [".github/CODEOWNERS"]]);
      expect(shop.activity.linksFor(id)).toMatchObject({ protectedPaths: [".github/CODEOWNERS"], approvedPaths: [".github/workflows/lint.yml"] });
    });

    it("approves a protected file blocked in a follow-up without running anything, so the follow-up can be sent again", async () => {
      let runs = 0;
      const shop = await createShop((dir) => (++runs === 1 ? touching()(dir) : touching(".github/workflows/lint.yml")(dir)));
      const id = await proposeAndSign(shop);
      await shop.flow.followUp(id, "add a workflow");
      await shop.flow.idle();
      expect(shop.activity.linksFor(id).protectedPaths).toEqual([".github/workflows/lint.yml"]);

      const approved = await shop.flow.approveProtected(id);
      expect(approved.ok).toBe(true);
      expect(shop.engine.requests).toHaveLength(2);

      await shop.flow.followUp(id, "add a workflow");
      await shop.flow.idle();

      expect(await shop.eventTypes()).toContain("delivery.pull_request_updated");
    });

    it("refuses an order that is not waiting for approval, and one that does not exist", async () => {
      const shop = await createShop(async () => undefined);
      const id = await proposeAndSign(shop);

      expect(await shop.flow.approveProtected(id)).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
      expect(await shop.flow.approveProtected("WO-0099")).toMatchObject({ ok: false, error: { kind: "not_found" } });
      expect(shop.engine.requests).toHaveLength(1);
    });
  });
});
