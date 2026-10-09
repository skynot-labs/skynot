import { join } from "node:path";
import {
  GhVcs,
  GitWorkspace,
  Implementer,
  IssueFiler,
  type Vcs,
  type Workspace,
} from "../delivery";
import {
  ClaudeEngine,
  CodexEngine,
  RunScheduler,
  RunsProjection,
  type EngineName,
  type RoleEngine,
} from "../execution";
import { ActionBudget, ActionCounts, type Policy } from "../governance";
import { systemClock, type Clock } from "../kernel";
import { attachProjection, EventLog, JsonlEventStore, type StoredEvent } from "../kernel/events";
import { ChatProjection, ManagerService } from "../manager";
import { OrderService, OrdersProjection } from "../orders";
import { ActivityProjection } from "./activity";
import { createDeliveryRules } from "./delivery-rules";
import { createManagerRunner } from "./model-runner";
import { MergeWatcher } from "./merge-watcher";
import { createOrderDesk } from "./order-desk";
import { OrderFlow } from "./order-flow";
import { createWorkerRunner } from "./worker-runner";

export interface ShopConfig {
  policy: Policy;
  dataDir: string;
  managerEngine: EngineName;
  workerEngine: EngineName;
  managerCwd?: string;
  engines?: Partial<Record<EngineName, RoleEngine>>;
  vcs?: Vcs;
  workspace?: Workspace;
  clock?: Clock;
  repo?: string;
  reportError?: (error: unknown, event: StoredEvent) => void;
}

export interface Shop {
  log: EventLog;
  orders: OrdersProjection;
  chat: ChatProjection;
  runs: RunsProjection;
  activity: ActivityProjection;
  orderService: OrderService;
  manager: ManagerService;
  flow: OrderFlow;
  watcher: MergeWatcher;
  repo: string;
  stop(): void;
}

const MANAGER_TIMEOUT_MS = 180_000;

export async function createShop(config: ShopConfig): Promise<Shop> {
  const { policy, dataDir } = config;
  const clock = config.clock ?? systemClock;
  const repo = config.repo ?? policy.repos[0]!.name;

  const log = new EventLog(new JsonlEventStore(join(dataDir, "events.jsonl")), clock, config.reportError);
  const orders = new OrdersProjection();
  const chat = new ChatProjection();
  const runs = new RunsProjection();
  const activity = new ActivityProjection();
  const counts = new ActionCounts();
  for (const projection of [orders, chat, runs, activity, counts]) await attachProjection(log, projection);

  const engines = config.engines ?? { claude: new ClaudeEngine(), codex: new CodexEngine() };
  const scheduler = new RunScheduler(engines, log, policy.limits.max_parallel);
  const vcs = config.vcs ?? new GhVcs();
  const workspace = config.workspace ?? new GitWorkspace({ root: join(dataDir, "workspaces") });
  const rules = createDeliveryRules(policy, new ActionBudget(policy, log, counts, clock));

  const orderService = new OrderService(log, orders);
  const manager = new ManagerService({
    log,
    chat,
    runner: createManagerRunner(scheduler, {
      engine: config.managerEngine,
      cwd: config.managerCwd ?? dataDir,
      timeoutMs: MANAGER_TIMEOUT_MS,
      maxUsd: policy.run_budget.max_usd,
    }),
    desk: createOrderDesk(orderService, orders),
  });

  const flow = new OrderFlow({
    log,
    orders: orderService,
    filer: new IssueFiler({ log, vcs, rules }),
    implementer: new Implementer({
      log,
      vcs,
      workspace,
      worker: createWorkerRunner(scheduler, { engine: config.workerEngine }),
      rules,
    }),
    repo,
    findOrder: (id) => orders.get(id),
  });
  const stopFlow = flow.start();

  const watcher = new MergeWatcher({ log, vcs, orders, orderService, repo });

  return {
    log,
    orders,
    chat,
    runs,
    activity,
    orderService,
    manager,
    flow,
    watcher,
    repo,
    stop() {
      stopFlow();
      watcher.stop();
    },
  };
}
