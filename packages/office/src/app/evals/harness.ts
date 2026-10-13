import { RunScheduler, type EngineFailure, type EngineName, type RoleEngine } from "../../execution";
import { newId, ok, systemClock } from "../../kernel";
import { attachProjection, EventLog, InMemoryEventStore, type StoredEvent } from "../../kernel/events";
import { ChatProjection, ManagerService, ReportsProjection, type OrderOverview, type Relay, type ScheduledTask, type Standing, type TaskProposal, type WaitingWorker } from "../../manager";
import { WorkOrderSpecSchema, type WorkOrderSpec } from "../../orders";
import { createManagerRunner } from "../model-runner";

export interface EvalSeed {
  orders: OrderOverview[];
  waiting: WaitingWorker[];
  inReview?: string[];
  standing?: Standing;
  // What the Manager reported before this turn, oldest first.
  reports?: Array<{ title: string; text: string }>;
  conversation: Array<{ author: "director" | "manager"; text: string }>;
}

export interface Observed {
  reply: string;
  question: { text: string; options: readonly string[] } | null;
  plans: WorkOrderSpec[][];
  relays: Relay[];
  briefings: string[];
  scheduled: TaskProposal[];
  // Answers the service refused before the one it acted on.
  rejected: string[];
}

export type Verdict = { pass: true } | { pass: false; why: string };

export const PASS: Verdict = { pass: true };
export const fail = (why: string): Verdict => ({ pass: false, why });

export interface EvalCase {
  name: string;
  seed: EvalSeed;
  // What the director says, the scheduled task that is due, or the ticket that was filed.
  message: string | ScheduledTask | { ticket: { number: number; title: string; body: string } };
  check(observed: Observed): Verdict;
}

export interface EvalSetup {
  engines: Partial<Record<EngineName, RoleEngine>>;
  engine: EngineName;
  model?: string;
  repoDir: string;
  timeoutMs: number;
  maxUsd?: number;
}

interface Spent {
  costUsd: number | null;
  models: string[];
}

export type RunResult = Spent & ({ outcome: "pass" } | { outcome: "fail"; why: string; answered: string } | { outcome: "error"; message: string });

export interface CaseReport {
  name: string;
  runs: RunResult[];
}

const ANSWER_CHARS = 400;
// What the office's clock reads in every case: a Tuesday.
export const EVAL_CLOCK = "Tue 2026-10-13 10:00";

export async function runCase(evalCase: EvalCase, setup: EvalSetup): Promise<RunResult> {
  const { seed } = evalCase;
  const log = new EventLog(new InMemoryEventStore(), systemClock);
  const chat = new ChatProjection();
  const reports = new ReportsProjection();
  await attachProjection(log, chat);
  await attachProjection(log, reports);
  await log.record((seed.reports ?? []).map((report) => ({ type: "manager.reported", payload: { reportId: newId("rep"), taskId: "seeded", ...report } })));
  await log.record(
    seed.conversation.map((entry) =>
      entry.author === "director"
        ? { type: "manager.message_received", payload: { messageId: newId("msg"), text: entry.text } }
        : { type: "manager.replied", payload: { messageId: newId("msg"), text: entry.text, orderId: null, decisionId: null } },
    ),
  );

  const turn: StoredEvent[] = [];
  log.subscribe((event) => void turn.push(event));
  const observed: Observed = { reply: "", question: null, plans: [], relays: [], briefings: [], scheduled: [], rejected: [] };

  const manager = new ManagerService({
    log,
    chat,
    reports,
    runner: createManagerRunner(new RunScheduler(setup.engines, log, 1), {
      engine: setup.engine,
      cwd: async () => setup.repoDir,
      timeoutMs: setup.timeoutMs,
      ...(setup.model && { model: setup.model }),
      ...(setup.maxUsd && { maxUsd: setup.maxUsd }),
    }),
    ...(seed.standing && { standing: { read: () => seed.standing! } }),
    desk: {
      specSchema: WorkOrderSpecSchema,
      overview: () => seed.orders,
      async propose(specs) {
        observed.plans.push(specs as WorkOrderSpec[]);
        return ok({ id: "WO-9000", card: `(${specs.length} order(s) filed)` });
      },
    },
    briefingDesk: {
      async propose({ text }) {
        observed.briefings.push(text);
        return ok({ text: "(briefing change filed)" });
      },
    },
    tasks: {
      clock: () => EVAL_CLOCK,
      scheduled: () => [],
      async schedule(proposal) {
        observed.scheduled.push(proposal);
        return ok({ text: "(task scheduled)" });
      },
    },
    workers: {
      waiting: () => seed.waiting,
      inReview: () => seed.inReview ?? [],
      async passOn(relay) {
        observed.relays.push(relay);
        return ok(undefined);
      },
    },
  });

  try {
    const { message } = evalCase;
    await (typeof message === "string" ? manager.handleMessage(message) : "ticket" in message ? manager.handleTicket(message.ticket) : manager.handleTask(message));
  } catch (error) {
    return { outcome: "error", message: (error as Error).message, ...spentIn(turn) };
  }

  const spent = spentIn(turn);
  const failure = turn.find((event) => event.type === "execution.run_failed");
  if (failure) return { outcome: "error", message: (failure.payload as { failure: EngineFailure }).failure.message, ...spent };

  for (const event of turn) {
    if (event.type === "manager.replied" || event.type === "manager.reported") observed.reply = (event.payload as { text: string }).text;
    if (event.type === "manager.answer_rejected") observed.rejected.push((event.payload as { issues: string }).issues);
    if (event.type === "manager.decision_asked") {
      const { question, options } = event.payload as { question: string; options: string[] };
      observed.question = { text: question, options };
    }
  }

  const verdict = evalCase.check(observed);
  return verdict.pass ? { outcome: "pass", ...spent } : { outcome: "fail", why: verdict.why, answered: describe(observed), ...spent };
}

function spentIn(events: readonly StoredEvent[]): Spent {
  const costs: number[] = [];
  const models = new Set<string>();
  for (const event of events) {
    if (event.type === "execution.run_completed") {
      const { costUsd, model } = event.payload as { costUsd: number | null; model?: string };
      if (costUsd !== null) costs.push(costUsd);
      if (model) models.add(model);
    }
    if (event.type === "execution.run_failed") {
      const { costUsd } = (event.payload as { failure: EngineFailure }).failure;
      if (costUsd !== undefined) costs.push(costUsd);
    }
  }
  return { costUsd: costs.length ? costs.reduce((total, cost) => total + cost, 0) : null, models: [...models] };
}

function describe(observed: Observed): string {
  const parts = [
    `message: ${observed.reply}`,
    ...(observed.question ? [`question: ${observed.question.text} [${observed.question.options.join(" | ")}]`] : []),
    ...observed.relays.map((relay) => `relay to ${relay.orderId} from ${relay.from}: ${relay.text}`),
    ...observed.plans.map((plan) => `plan: ${plan.map((order) => order.title).join("; ")}`),
    ...observed.briefings.map((text) => `briefing: ${text}`),
    ...observed.scheduled.map((task) => `scheduled: ${task.title} ${JSON.stringify(task.when)}`),
    ...observed.rejected.map((issues) => `rejected first: ${issues}`),
  ];
  const text = parts.join(" / ").replace(/\s+/g, " ");
  return text.length > ANSWER_CHARS ? `${text.slice(0, ANSWER_CHARS)}…` : text;
}

export async function runTimes(evalCase: EvalCase, setup: EvalSetup, runs: number): Promise<CaseReport> {
  return { name: evalCase.name, runs: await Promise.all(Array.from({ length: runs }, () => runCase(evalCase, setup))) };
}

const count = (report: CaseReport, outcome: RunResult["outcome"]) => report.runs.filter((run) => run.outcome === outcome).length;

export function formatCase(report: CaseReport): string {
  const errors = count(report, "error");
  const lines = [`${report.name}: ${count(report, "pass")}/${report.runs.length}${errors ? ` (${errors} could not run)` : ""}`];
  report.runs.forEach((run, index) => {
    if (run.outcome === "fail") lines.push(`  run ${index + 1} failed: ${run.why}`, `    ${run.answered}`);
    if (run.outcome === "error") lines.push(`  run ${index + 1} error: ${run.message}`);
  });
  return lines.join("\n");
}

export function formatTotal(reports: readonly CaseReport[]): string {
  const runs = reports.flatMap((report) => report.runs);
  const errors = runs.filter((run) => run.outcome === "error").length;
  const costs = runs.flatMap((run) => (run.costUsd === null ? [] : [run.costUsd]));
  const models = [...new Set(runs.flatMap((run) => run.models))];
  return [
    `total: ${runs.filter((run) => run.outcome === "pass").length}/${runs.length} runs passed`,
    ...(errors ? [`${errors} could not run`] : []),
    costs.length ? `cost $${costs.reduce((total, cost) => total + cost, 0).toFixed(2)}` : "the engine reported no cost",
    ...(models.length ? [`answered by ${models.join(", ")}`] : []),
  ].join(", ");
}

// A run that could not run is not a pass: a case nobody could judge does not clear the threshold.
export function casesBelow(reports: readonly CaseReport[], min: number): string[] {
  return reports.filter((report) => count(report, "pass") < Math.min(min, report.runs.length)).map((report) => report.name);
}
