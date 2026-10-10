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
  ShopControl,
  type EngineName,
  type RoleEngine,
} from "../execution";
import { ActionBudget, ActionCounts, type Policy } from "../governance";
import { systemClock, type Clock } from "../kernel";
import { attachProjection, EventLog, JsonlEventStore, LastSequence, type StoredEvent } from "../kernel/events";
import { ChatProjection, ManagerService } from "../manager";
import { OrderService, OrdersProjection } from "../orders";
import { RosterProjection, TeamService, type RoleSetup, type Team } from "../team";
import { ActivityProjection } from "./activity";
import { createAdvisorBench } from "./advisor-bench";
import { BlockedNotice } from "./blocked-notice";
import { CostGuard } from "./cost-guard";
import { createDeliveryRules } from "./delivery-rules";
import { createManagerRunner } from "./model-runner";
import { MergeWatcher } from "./merge-watcher";
import { createOrderDesk } from "./order-desk";
import { createTeamDesk } from "./team-desk";
import { OrderFlow } from "./order-flow";
import { createWorkerRunner } from "./worker-runner";

export interface ShopConfig {
  policy: Policy;
  dataDir: string;
  team: Team;
  engines?: Partial<Record<EngineName, RoleEngine>>;
  vcs?: Vcs;
  workspace?: Workspace;
  clock?: Clock;
  repo?: string;
  reportError?: (error: unknown, event: StoredEvent) => void;
}

const withModel = ({ model }: RoleSetup) => (model ? { model } : {});

export interface Shop {
  team: Team;
  roster: RosterProjection;
  teamService: TeamService;
  log: EventLog;
  orders: OrdersProjection;
  chat: ChatProjection;
  runs: RunsProjection;
  scheduler: RunScheduler;
  control: ShopControl;
  activity: ActivityProjection;
  orderService: OrderService;
  manager: ManagerService;
  flow: OrderFlow;
  watcher: MergeWatcher;
  cursor: LastSequence;
  repo: string;
  maxUsdPerDay: number | undefined;
  stop(): void;
}

const MANAGER_TIMEOUT_MS = 180_000;

export async function createShop(config: ShopConfig): Promise<Shop> {
  const { policy, dataDir } = config;
  const clock = config.clock ?? systemClock;
  const repo = config.repo ?? policy.repos[0]!.name;
  const repoRules = policy.repos.find((candidate) => candidate.name === repo) ?? policy.repos[0]!;

  const log = new EventLog(new JsonlEventStore(join(dataDir, "events.jsonl")), clock, config.reportError);
  const orders = new OrdersProjection();
  const chat = new ChatProjection();
  const runs = new RunsProjection();
  const activity = new ActivityProjection();
  const counts = new ActionCounts();
  const cursor = new LastSequence();
  const roster = new RosterProjection(config.team);
  const control = new ShopControl(log);
  for (const projection of [orders, chat, runs, activity, counts, cursor, roster, control]) await attachProjection(log, projection);

  const engines = config.engines ?? { claude: new ClaudeEngine(), codex: new CodexEngine() };
  const scheduler = new RunScheduler(engines, log, policy.limits.max_parallel, () => control.paused() !== null);
  const vcs = config.vcs ?? new GhVcs();
  const workspace = config.workspace ?? new GitWorkspace({ root: join(dataDir, "workspaces") });
  const rules = createDeliveryRules(policy, new ActionBudget(policy, log, counts, clock));

  const orderService = new OrderService(log, orders);
  const teamService = new TeamService(log, roster);
  const manager = new ManagerService({
    log,
    chat,
    runner: createManagerRunner(scheduler, {
      engine: config.team.roles.manager.engine,
      ...withModel(config.team.roles.manager),
      cwd: async () => workspace.readingCopy(repo, repoRules.base_branch),
      timeoutMs: MANAGER_TIMEOUT_MS,
      maxUsd: policy.run_budget.max_usd,
    }),
    desk: createOrderDesk(orderService, orders),
    team: createTeamDesk(teamService, roster),
    advisors: createAdvisorBench(scheduler, () => roster.members(), {
      cwd: async () => workspace.readingCopy(repo, repoRules.base_branch),
      timeoutMs: MANAGER_TIMEOUT_MS,
      maxUsd: policy.run_budget.max_usd,
    }),
  });

  const flow = new OrderFlow({
    log,
    orders: orderService,
    filer: new IssueFiler({ log, vcs, rules }),
    implementer: new Implementer({
      log,
      vcs,
      workspace,
      worker: createWorkerRunner(scheduler, { engine: config.team.roles.developer.engine, ...withModel(config.team.roles.developer) }),
      rules,
    }),
    repo,
    findOrder: (id) => orders.get(id),
    listOrders: () => orders.list(),
    progressOf: (id) => activity.linksFor(id),
  });
  const stopFlow = flow.start();
  const stopCostGuard = new CostGuard({
    log,
    runs,
    control,
    maxUsdPerDay: policy.run_budget.max_usd_per_day,
    ...(config.reportError && { onError: config.reportError }),
  }).start();
  const stopNotice = new BlockedNotice({
    log,
    say: (text, orderId) => manager.tell(text, { orderId }),
    findOrder: (id) => orders.get(id),
    protectedPathsOf: (id) => activity.linksFor(id).protectedPaths,
    ...(config.reportError && { onError: config.reportError }),
  }).start();

  await flow.recover();

  const watcher = new MergeWatcher({ log, vcs, orders, orderService, repo });

  return {
    team: config.team,
    roster,
    teamService,
    log,
    orders,
    chat,
    runs,
    scheduler,
    control,
    activity,
    orderService,
    manager,
    flow,
    watcher,
    cursor,
    repo,
    maxUsdPerDay: policy.run_budget.max_usd_per_day,
    stop() {
      stopFlow();
      stopNotice();
      stopCostGuard();
      watcher.stop();
    },
  };
}
