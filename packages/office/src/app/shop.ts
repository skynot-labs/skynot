import { join } from "node:path";
import {
  GhBoard,
  GhVcs,
  GitWorkspace,
  Implementer,
  IssueFiler,
  PullRequestReview,
  type Board,
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
import { attachProjection, EventLog, inProject, JsonlEventStore, LastSequence, type StoredEvent } from "../kernel/events";
import { ChatProjection, ManagerService } from "../manager";
import { OrderService, OrdersProjection, type WorkOrder } from "../orders";
import { BriefingChanges, BriefingService, withSignedChanges, type BriefingStore, type Project } from "../projects";
import { RosterProjection, TeamService, type RoleSetup, type Team } from "../team";
import type { Exec } from "../kernel/process";
import { CODEX_SANDBOX, type Finding } from "./readiness";
import { ActivityProjection } from "./activity";
import { createAdvisorBench } from "./advisor-bench";
import { createBriefingDesk } from "./briefing-desk";
import { BlockedNotice } from "./blocked-notice";
import { CostGuard } from "./cost-guard";
import { BoardMirror } from "./board-mirror";
import { IntakeProjection, IntakeWatcher } from "./intake";
import { createCodeReviewer } from "./code-reviewer";
import { createDeliveryRules } from "./delivery-rules";
import { createManagerRunner } from "./model-runner";
import { MergeWatcher } from "./merge-watcher";
import { projectsFromPolicy } from "./projects";
import { createOrderDesk } from "./order-desk";
import { PreferencesProjection } from "./preferences";
import { createTeamDesk } from "./team-desk";
import { OrderFlow } from "./order-flow";
import { ReviewNotice } from "./review-notice";
import { createWorkerRunner, DEFAULT_WORKER } from "./worker-runner";

export interface ShopConfig {
  policy: Policy;
  dataDir: string;
  // The team of every project that has none of its own in `teams`.
  team: Team;
  teams?: Record<string, Team>;
  engines?: Partial<Record<EngineName, RoleEngine>>;
  vcs?: Vcs;
  workspace?: Workspace;
  // How gh and git are run; main passes one that acts as the GitHub App when it is configured.
  exec?: Exec;
  // The same for commands about one account that do not name it: a board is moved by ids.
  execFor?: (account: string) => Exec;
  clock?: Clock;
  projects?: Project[];
  briefing?: BriefingStore;
  // The board of a project, when it has one; by default the GitHub board its project.yaml names.
  boardOf?: (project: Project) => Board | undefined;
  readiness?: () => Promise<Finding[]>;
  reportError?: (error: unknown, event: StoredEvent) => void;
}

const withModel = ({ model }: RoleSetup) => (model ? { model } : {});

// What belongs to one project: its team, its conversation with the Manager and the Manager itself.
export interface ProjectDesk {
  project: Project;
  team: Team;
  roster: RosterProjection;
  teamService: TeamService;
  chat: ChatProjection;
  manager: ManagerService;
  reviewer: PullRequestReview | undefined;
  workers: string[];
}

export interface Shop {
  desks: ProjectDesk[];
  desk(projectId: string): ProjectDesk | undefined;
  deskOf(order: WorkOrder): ProjectDesk;
  // the first project, for what has one answer per shop
  team: Team;
  roster: RosterProjection;
  teamService: TeamService;
  chat: ChatProjection;
  manager: ManagerService;
  log: EventLog;
  orders: OrdersProjection;
  runs: RunsProjection;
  scheduler: RunScheduler;
  control: ShopControl;
  activity: ActivityProjection;
  preferences: PreferencesProjection;
  orderService: OrderService;
  briefingChanges: BriefingChanges;
  briefingService: BriefingService;
  flow: OrderFlow;
  watcher: MergeWatcher;
  intake: IntakeWatcher;
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
  const first = projects[0];
  if (!first) throw new Error("the shop needs at least one project");

  const log = new EventLog(new JsonlEventStore(join(dataDir, "events.jsonl")), clock, config.reportError);
  const orders = new OrdersProjection(first.id);
  const runs = new RunsProjection(first.id);
  const activity = new ActivityProjection(first.id);
  const counts = new ActionCounts();
  const taken = new IntakeProjection();
  const briefingChanges = new BriefingChanges();
  const cursor = new LastSequence();
  const control = new ShopControl(log);
  const preferences = new PreferencesProjection();
  for (const projection of [orders, runs, activity, counts, cursor, control, taken, briefingChanges, preferences]) await attachProjection(log, projection);

  await closeOrphanedRuns(runs, log);
  const engines = config.engines ?? { claude: new ClaudeEngine(), codex: new CodexEngine() };
  let findings: readonly Finding[] = [];
  const sandboxBroken = () => findings.some((finding) => finding.check === CODEX_SANDBOX && finding.level !== "ok");
  const scheduler = new RunScheduler(engines, log, policy.limits.max_parallel, (projectId) => control.pausedFor(projectId) !== null);
  const vcs = config.vcs ?? new GhVcs(config.exec);
  const workspace = config.workspace ?? new GitWorkspace({ root: join(dataDir, "workspaces"), ...(config.exec && { execute: config.exec }) });
  const rules = createDeliveryRules(policy, new ActionBudget(policy, log, counts, clock), projects);
  const orderService = new OrderService(log, orders);
  const briefingService = new BriefingService(log, briefingChanges);
  const briefing = config.briefing && withSignedChanges(config.briefing, briefingChanges, policy.memory.max_memory_chars);

  const desks = new Map<string, ProjectDesk>();
  for (const [index, project] of projects.entries()) {
    const team = config.teams?.[project.id] ?? config.team;
    const scope = { id: project.id, isFirst: index === 0 };
    const roster = new RosterProjection(team, scope);
    const chat = new ChatProjection(scope);
    for (const projection of [roster, chat]) await attachProjection(log, projection);

    const scoped = inProject(log, project.id);
    const teamService = new TeamService(scoped, roster);
    const reading = { cwd: async () => workspace.readingCopy(project.repo, project.baseBranch), timeoutMs: MANAGER_TIMEOUT_MS, maxUsd: policy.run_budget.max_usd, projectId: project.id };
    const reviewerRole = team.roles.code_reviewer;
    desks.set(project.id, {
      project,
      team,
      roster,
      teamService,
      chat,
      manager: new ManagerService({
        log: scoped,
        chat,
        runner: createManagerRunner(scheduler, { engine: team.roles.manager.engine, ...withModel(team.roles.manager), ...reading }),
        desk: createOrderDesk(orderService, orders, project.id),
        ...(briefing && { briefing: { read: () => briefing.read(project.id) } }),
        briefingDesk: createBriefingDesk(briefingService, project.id),
        team: createTeamDesk(teamService, roster),
        advisors: createAdvisorBench(scheduler, () => roster.members(), reading),
      }),
      reviewer: reviewerRole
        ? new PullRequestReview({ log, vcs, reviewer: createCodeReviewer(scheduler, { engine: reviewerRole.engine, ...withModel(reviewerRole), ...reading, diffOnly: () => reviewerRole.engine === "codex" && sandboxBroken() }) })
        : undefined,
      workers: [DEFAULT_WORKER, ...Object.keys(team.workers ?? {})],
    });
  }
  const firstDesk = desks.get(first.id)!;
  const deskOf = (order: WorkOrder): ProjectDesk => desks.get(order.projectId) ?? firstDesk;
  const deskOfOrder = (orderId: string): ProjectDesk => {
    const order = orders.get(orderId);
    return order ? deskOf(order) : firstDesk;
  };
  const workersOf = (orderId: string): Record<string, RoleSetup> => {
    const { team } = deskOfOrder(orderId);
    return { [DEFAULT_WORKER]: team.roles.developer, ...team.workers };
  };

  const flow = new OrderFlow({
    reviewerFor: (order) => deskOf(order).reviewer,
    log,
    orders: orderService,
    filer: new IssueFiler({ log, vcs, rules }),
    implementer: new Implementer({
      log,
      vcs,
      workspace,
      worker: createWorkerRunner(scheduler, { workers: workersOf, assigneeOf: (id) => activity.linksFor(id).worker, projectOf: (id) => deskOfOrder(id).project.id }),
      rules,
    }),
    repoOf: (order) => deskOf(order).project.repo,
    findOrder: (id) => orders.get(id),
    listOrders: () => orders.list(),
    workersOf: (order) => deskOf(order).workers,
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
  const say = (text: string, orderId: string) => deskOfOrder(orderId).manager.tell(text, { orderId });
  const stopReviewNotice = new ReviewNotice({ log, say, ...(config.reportError && { onError: config.reportError }) }).start();
  const stopNotice = new BlockedNotice({
    log,
    say,
    findOrder: (id) => orders.get(id),
    protectedPathsOf: (id) => activity.linksFor(id).protectedPaths,
    ...(config.reportError && { onError: config.reportError }),
  }).start();

  const boardOfProject = config.boardOf ?? ((project: Project) => (project.board ? new GhBoard(project.board, config.execFor?.(project.board.owner) ?? config.exec) : undefined));
  const boards = new Map(projects.map((project) => [project.id, boardOfProject(project)] as const));
  const stopMirror = new BoardMirror({
    log,
    findOrder: (id) => orders.get(id),
    issueUrlOf: (id) => activity.linksFor(id).issueUrl,
    ticketUrlOf: (order) => (order.ticket === null ? null : `https://github.com/${deskOf(order).project.repo}/issues/${order.ticket}`),
    boardOf: (projectId) => boards.get(projectId),
    ...(config.reportError && { onError: config.reportError }),
  }).start();

  await flow.recover();

  const readiness = {
    findings: () => findings,
    async refresh() {
      findings = config.readiness ? await config.readiness().catch((error) => [{ check: "readiness", level: "fail" as const, detail: (error as Error).message }]) : [];
    },
  };

  const intake = new IntakeWatcher({
    log,
    vcs,
    intake: taken,
    label: policy.labels.intake ?? `${policy.labels.prefix}ready`,
    targets: () => [...desks.values()].map((desk) => ({ projectId: desk.project.id, repo: desk.project.repo, handle: (ticket) => desk.manager.handleTicket(ticket) })),
    ...(config.reportError && { onError: (error: unknown) => config.reportError!(error, { type: "intake", payload: {} } as StoredEvent) }),
  });
  const watcher = new MergeWatcher({ log, vcs, orders, orderService, repoOf: (order) => deskOf(order).project.repo, flow, progressOf: (id) => activity.linksFor(id) });

  return {
    desks: [...desks.values()],
    desk: (projectId) => desks.get(projectId),
    deskOf,
    team: firstDesk.team,
    roster: firstDesk.roster,
    teamService: firstDesk.teamService,
    chat: firstDesk.chat,
    manager: firstDesk.manager,
    log,
    orders,
    runs,
    scheduler,
    control,
    activity,
    preferences,
    orderService,
    briefingChanges,
    briefingService,
    flow,
    watcher,
    intake,
    cursor,
    repo: first.repo,
    reviewing: firstDesk.reviewer !== undefined,
    readiness,
    workers: firstDesk.workers,
    maxUsdPerDay: policy.run_budget.max_usd_per_day,
    stop() {
      stopFlow();
      stopNotice();
      stopReviewNotice();
      stopCostGuard();
      stopMirror();
      watcher.stop();
      intake.stop();
    },
  };
}
