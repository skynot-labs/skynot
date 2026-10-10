import { join } from "node:path";
import {
  GhVcs,
  GitWorkspace,
  Implementer,
  IssueFiler,
  PullRequestReview,
  type Vcs,
  type Workspace,
} from "../delivery";
import {
  ClaudeEngine,
  CodexEngine,
  closeOrphanedRuns,
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
import type { BriefingStore, Project } from "../projects";
import { RosterProjection, TeamService, type RoleSetup, type Team } from "../team";
import type { Finding } from "./readiness";
import { ActivityProjection } from "./activity";
import { createAdvisorBench } from "./advisor-bench";
import { BlockedNotice } from "./blocked-notice";
import { CostGuard } from "./cost-guard";
import { createCodeReviewer } from "./code-reviewer";
import { createDeliveryRules } from "./delivery-rules";
import { createManagerRunner } from "./model-runner";
import { MergeWatcher } from "./merge-watcher";
import { projectsFromPolicy } from "./projects";
import { createOrderDesk } from "./order-desk";
import { createTeamDesk } from "./team-desk";
import { OrderFlow } from "./order-flow";
import { ReviewNotice } from "./review-notice";
import { createWorkerRunner, DEFAULT_WORKER } from "./worker-runner";

export interface ShopConfig {
  policy: Policy;
  dataDir: string;
  team: Team;
  engines?: Partial<Record<EngineName, RoleEngine>>;
  vcs?: Vcs;
  workspace?: Workspace;
  clock?: Clock;
  projects?: Project[];
  briefing?: BriefingStore;
  readiness?: () => Promise<Finding[]>;
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
  readiness: { findings(): readonly Finding[]; refresh(): Promise<void> };
  reviewing: boolean;
  workers: string[];
  maxUsdPerDay: number | undefined;
  stop(): void;
}

const MANAGER_TIMEOUT_MS = 180_000;

export async function createShop(config: ShopConfig): Promise<Shop> {
  const { policy, dataDir } = config;
  const clock = config.clock ?? systemClock;
  const projects = config.projects ?? projectsFromPolicy(policy);
  const project = projects[0];
  if (!project) throw new Error("the shop needs at least one project");
  const repo = project.repo;

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

  await closeOrphanedRuns(runs, log);
  const engines = config.engines ?? { claude: new ClaudeEngine(), codex: new CodexEngine() };
  const scheduler = new RunScheduler(engines, log, policy.limits.max_parallel, () => control.paused() !== null);
  const vcs = config.vcs ?? new GhVcs();
  const workspace = config.workspace ?? new GitWorkspace({ root: join(dataDir, "workspaces") });
  const rules = createDeliveryRules(policy, new ActionBudget(policy, log, counts, clock), projects);

  const orderService = new OrderService(log, orders);
  const teamService = new TeamService(log, roster);
  const manager = new ManagerService({
    log,
    chat,
    runner: createManagerRunner(scheduler, {
      engine: config.team.roles.manager.engine,
      ...withModel(config.team.roles.manager),
      cwd: async () => workspace.readingCopy(repo, project.baseBranch),
      timeoutMs: MANAGER_TIMEOUT_MS,
      maxUsd: policy.run_budget.max_usd,
    }),
    desk: createOrderDesk(orderService, orders),
    ...(config.briefing && { briefing: { read: () => config.briefing!.read(project.id) } }),
    team: createTeamDesk(teamService, roster),
    advisors: createAdvisorBench(scheduler, () => roster.members(), {
      cwd: async () => workspace.readingCopy(repo, project.baseBranch),
      timeoutMs: MANAGER_TIMEOUT_MS,
      maxUsd: policy.run_budget.max_usd,
    }),
  });

  const workers = (): Record<string, RoleSetup> => ({ [DEFAULT_WORKER]: config.team.roles.developer, ...config.team.workers });
  const reviewerRole = config.team.roles.code_reviewer;
  const reviewer = reviewerRole
    ? new PullRequestReview({
        log,
        vcs,
        reviewer: createCodeReviewer(scheduler, {
          engine: reviewerRole.engine,
          ...withModel(reviewerRole),
          cwd: async () => workspace.readingCopy(repo, project.baseBranch),
          timeoutMs: MANAGER_TIMEOUT_MS,
          maxUsd: policy.run_budget.max_usd,
        }),
      })
    : undefined;

  const flow = new OrderFlow({
    ...(reviewer && { reviewer }),
    log,
    orders: orderService,
    filer: new IssueFiler({ log, vcs, rules }),
    implementer: new Implementer({
      log,
      vcs,
      workspace,
      worker: createWorkerRunner(scheduler, { workers, assigneeOf: (id) => activity.linksFor(id).worker }),
      rules,
    }),
    repo,
    findOrder: (id) => orders.get(id),
    listOrders: () => orders.list(),
    workers: () => Object.keys(workers()),
    ...(config.reportError && { onError: config.reportError }),
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
  const stopReviewNotice = new ReviewNotice({
    log,
    say: (text, orderId) => manager.tell(text, { orderId }),
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

  let findings: readonly Finding[] = [];
  const readiness = {
    findings: () => findings,
    async refresh() {
      findings = config.readiness ? await config.readiness().catch((error) => [{ check: "readiness", level: "fail" as const, detail: (error as Error).message }]) : [];
    },
  };

  const watcher = new MergeWatcher({ log, vcs, orders, orderService, repo, flow, progressOf: (id) => activity.linksFor(id) });

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
    reviewing: reviewer !== undefined,
    readiness,
    workers: Object.keys(workers()),
    maxUsdPerDay: policy.run_budget.max_usd_per_day,
    stop() {
      stopFlow();
      stopNotice();
      stopReviewNotice();
      stopCostGuard();
      watcher.stop();
    },
  };
}
