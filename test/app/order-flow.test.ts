import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { addFiles, cloneFrom, createSandbox, type Sandbox } from "../delivery/git-fixture";
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
    progressOf: (id) => activity.linksFor(id),
  });
  flow.start();

  const eventTypes = async () => (await log.readAfter(0)).map((event) => event.type).filter((type) => type.startsWith("delivery."));
  return { flow, orderService, orders, runs, vcs, engine, eventTypes };
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
});
