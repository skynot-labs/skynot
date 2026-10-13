import { readFile } from "node:fs/promises";
import { outcomeOf, RunsProjection, sumUsage, type EngineName, type Run, type TokenUsage } from "../execution";
import type { StoredEvent } from "../kernel/events";
import { OrdersProjection, type OrderStatus } from "../orders";
import { ActivityProjection, type OrderLinks } from "./activity";

type Verdict = "approved" | "changes_requested";

export interface OrderFlow {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: OrderStatus;
  // The worker and model of the order's first run that could write.
  readonly author: string | null;
  readonly signMs: number | null;
  readonly buildMs: number | null;
  readonly reviewMs: number | null;
  readonly mergeMs: number | null;
  readonly totalMs: number | null;
  readonly reviewRounds: number;
  readonly firstVerdict: Verdict | null;
  readonly firstReviewDiffOnly: boolean;
  readonly diffOnlyReviews: number;
  readonly blocks: number;
  readonly retries: number;
  readonly followUps: number;
  readonly questions: number;
  readonly runs: number;
  readonly spentUsd: number | null;
}

export interface RunGroup {
  readonly role: string;
  readonly engine: EngineName;
  readonly model: string | null;
  readonly runs: number;
  readonly unfinished: number;
  readonly spentUsd: number | null;
  readonly usage: TokenUsage | null;
  readonly medianMs: number | null;
  readonly medianTurns: number | null;
}

export interface AuthorGroup {
  readonly author: string;
  readonly orders: number;
  readonly delivered: number;
  readonly reviewed: number;
  readonly approvedFirst: number;
  readonly medianBuildMs: number | null;
  readonly usdPerOrder: number | null;
}

export interface StageMedians {
  readonly signMs: number | null;
  readonly buildMs: number | null;
  readonly reviewMs: number | null;
  readonly mergeMs: number | null;
  readonly totalMs: number | null;
}

export interface FlowStats {
  readonly from: string | null;
  readonly to: string | null;
  readonly orders: readonly OrderFlow[];
  readonly medians: StageMedians;
  readonly runs: readonly RunGroup[];
  readonly authors: readonly AuthorGroup[];
  readonly blockReasons: ReadonlyArray<{ reason: string; count: number }>;
  readonly refusedAnswers: number;
  readonly spentUsd: number | null;
}

interface Tally {
  pullRequestAt: string | null;
  readyAt: string | null;
  firstVerdict: Verdict | null;
  firstReviewDiffOnly: boolean;
  diffOnlyReviews: number;
  reviewRounds: number;
  blocks: number;
  retries: number;
  followUps: number;
  questions: number;
}

const newTally = (): Tally => ({ pullRequestAt: null, readyAt: null, firstVerdict: null, firstReviewDiffOnly: false, diffOnlyReviews: 0, reviewRounds: 0, blocks: 0, retries: 0, followUps: 0, questions: 0 });

// Stricter than the card's "ready": an order nobody reviewed never counts, so its review and merge times stay unknown.
const reviewedAndGreen = (links: OrderLinks): boolean =>
  links.review?.verdict === "approved" && !links.review.diffOnly && (links.checks === "none" || links.checks === "passing");

export function flowStats(events: readonly StoredEvent[], firstProject = "default"): FlowStats {
  const orders = new OrdersProjection(firstProject);
  const runs = new RunsProjection(firstProject);
  const activity = new ActivityProjection(firstProject);
  const tallies = new Map<string, Tally>();
  const blockReasons = new Map<string, number>();
  let refusedAnswers = 0;

  for (const event of events) {
    orders.apply(event);
    runs.apply(event);
    activity.apply(event);
    if (event.type === "manager.answer_rejected") refusedAnswers++;

    const payload = event.payload as { orderId?: unknown; reason?: unknown; verdict?: unknown; diffOnly?: unknown };
    if (typeof payload.orderId !== "string") continue;
    const tally = tallies.get(payload.orderId) ?? newTally();
    tallies.set(payload.orderId, tally);

    switch (event.type) {
      case "orders.pull_request_opened":
        tally.pullRequestAt ??= event.occurredAt;
        break;
      case "delivery.review_completed":
        if (tally.reviewRounds === 0) tally.firstReviewDiffOnly = payload.diffOnly === true;
        if (payload.diffOnly === true) tally.diffOnlyReviews++;
        tally.reviewRounds++;
        tally.firstVerdict ??= payload.verdict as Verdict;
        break;
      case "delivery.work_blocked": {
        const reason = String(payload.reason).split("\n")[0]!.trim();
        tally.blocks++;
        blockReasons.set(reason, (blockReasons.get(reason) ?? 0) + 1);
        break;
      }
      case "delivery.work_retried":
        tally.retries++;
        break;
      case "delivery.follow_up_requested":
        tally.followUps++;
        break;
      case "delivery.question_raised":
        tally.questions++;
        break;
    }

    if (orders.get(payload.orderId)?.deliveredAt) continue;
    if (!reviewedAndGreen(activity.linksFor(payload.orderId))) tally.readyAt = null;
    else tally.readyAt ??= event.occurredAt;
  }

  const allRuns = runs.list();
  const flows = orders.list().map((order): OrderFlow => {
    const tally = tallies.get(order.id) ?? newTally();
    const ofOrder = allRuns.filter((run) => run.orderId === order.id);
    const first = ofOrder.find((run) => run.access === "write");
    return {
      id: order.id,
      projectId: order.projectId,
      title: order.spec.title,
      status: order.status,
      author: first ? authorOf(first) : null,
      signMs: between(order.proposedAt, order.signedAt),
      buildMs: between(order.signedAt, tally.pullRequestAt),
      reviewMs: between(tally.pullRequestAt, tally.readyAt),
      mergeMs: between(tally.readyAt, order.deliveredAt),
      totalMs: between(order.signedAt, order.deliveredAt),
      reviewRounds: tally.reviewRounds,
      firstVerdict: tally.firstVerdict,
      firstReviewDiffOnly: tally.firstReviewDiffOnly,
      diffOnlyReviews: tally.diffOnlyReviews,
      blocks: tally.blocks,
      retries: tally.retries,
      followUps: tally.followUps,
      questions: tally.questions,
      runs: ofOrder.length,
      spentUsd: reported(ofOrder),
    };
  });

  const delivered = flows.filter((flow) => flow.status === "delivered");
  return {
    from: events[0]?.occurredAt ?? null,
    to: events.at(-1)?.occurredAt ?? null,
    orders: flows,
    medians: {
      signMs: median(delivered.map((flow) => flow.signMs)),
      buildMs: median(delivered.map((flow) => flow.buildMs)),
      reviewMs: median(delivered.map((flow) => flow.reviewMs)),
      mergeMs: median(delivered.map((flow) => flow.mergeMs)),
      totalMs: median(delivered.map((flow) => flow.totalMs)),
    },
    runs: groupRuns(allRuns),
    authors: groupAuthors(flows),
    blockReasons: [...blockReasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    refusedAnswers,
    spentUsd: reported(allRuns),
  };
}

const authorOf = (run: Run): string => `${run.role} · ${run.model ?? `${run.engine} default`}`;

function groupRuns(runs: readonly Run[]): RunGroup[] {
  const groups = new Map<string, Run[]>();
  for (const run of runs) {
    const key = `${run.role}\n${run.engine}\n${run.model ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()].map((group) => {
    const completed = group.filter((run) => outcomeOf(run) === "completed");
    return {
      role: group[0]!.role,
      engine: group[0]!.engine,
      model: group[0]!.model,
      runs: group.length,
      unfinished: group.length - completed.length,
      spentUsd: reported(group),
      usage: sumUsage(group.flatMap((run) => (run.usage ? [run.usage] : []))),
      medianMs: median(completed.map((run) => between(run.startedAt, run.finishedAt))),
      medianTurns: median(completed.map((run) => run.turns)),
    };
  });
}

// A first review made from the diff alone says nothing about the work: it could not read the repository or run a command.
const readTheRepository = (flow: OrderFlow): boolean => flow.firstVerdict !== null && !flow.firstReviewDiffOnly;

function groupAuthors(flows: readonly OrderFlow[]): AuthorGroup[] {
  const groups = new Map<string, OrderFlow[]>();
  for (const flow of flows) if (flow.author) groups.set(flow.author, [...(groups.get(flow.author) ?? []), flow]);
  return [...groups].map(([author, group]) => {
    const costs = group.flatMap((flow) => (flow.spentUsd === null ? [] : [flow.spentUsd]));
    return {
      author,
      orders: group.length,
      delivered: group.filter((flow) => flow.status === "delivered").length,
      reviewed: group.filter(readTheRepository).length,
      approvedFirst: group.filter((flow) => readTheRepository(flow) && flow.firstVerdict === "approved").length,
      medianBuildMs: median(group.map((flow) => flow.buildMs)),
      usdPerOrder: costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0) / costs.length,
    };
  });
}

// Only what engines reported: null when none did, otherwise a floor.
function reported(runs: readonly Run[]): number | null {
  const costs = runs.flatMap((run) => (run.costUsd === null ? [] : [run.costUsd]));
  return costs.length === 0 ? null : costs.reduce((total, cost) => total + cost, 0);
}

const between = (from: string | null, to: string | null): number | null => (from && to ? Date.parse(to) - Date.parse(from) : null);

function median(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 === 1 ? known[middle]! : (known[middle - 1]! + known[middle]!) / 2;
}

// Read without JsonlEventStore, which repairs a half-written last line: this may run beside a live office.
export async function readEventFile(path: string): Promise<StoredEvent[]> {
  const lines = (await readFile(path, "utf8")).split("\n").filter((line) => line.length > 0);
  return lines.flatMap((line, index) => {
    try {
      return [JSON.parse(line) as StoredEvent];
    } catch (error) {
      if (index === lines.length - 1) return [];
      throw new Error(`${path}: line ${index + 1} is not valid JSON`, { cause: error });
    }
  });
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const usd = (value: number | null): string => (value === null ? "-" : `$${value.toFixed(2)}`);

const count = (value: number | null): string => (value === null ? "-" : Math.round(value).toLocaleString("en-US"));

function table(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  const line = (cells: readonly string[]) => cells.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

export function formatFlowStats(stats: FlowStats): string {
  if (stats.orders.length === 0 && stats.runs.length === 0) return "The log has no orders and no runs yet.";

  const delivered = stats.orders.filter((order) => order.status === "delivered").length;
  const discarded = stats.orders.filter((order) => order.status === "discarded").length;
  const { medians } = stats;
  const sections = [
    [
      `${stats.from?.slice(0, 10)} to ${stats.to?.slice(0, 10)} · ${stats.orders.length} orders, ${delivered} delivered, ${discarded} discarded · ${usd(stats.spentUsd)} reported`,
      "",
      "Median of the delivered orders, stage by stage",
      table(
        ["sign", "build", "review", "merge", "total"],
        [[medians.signMs, medians.buildMs, medians.reviewMs, medians.mergeMs, medians.totalMs].map(formatDuration)],
      ),
      "sign: proposed to signed · build: signed to pull request · review: pull request to approved with checks not red",
      "merge: from there to merged · total: signed to delivered · review and merge are unknown for an order nobody reviewed",
    ].join("\n"),
    [
      "Orders",
      table(
        ["order", "status", "author", "sign", "build", "review", "merge", "total", "rounds", "first review", "blocks", "retries", "follow-ups", "questions", "runs", "cost"],
        stats.orders.map((order) => [
          order.id,
          order.status,
          order.author ?? "-",
          formatDuration(order.signMs),
          formatDuration(order.buildMs),
          formatDuration(order.reviewMs),
          formatDuration(order.mergeMs),
          formatDuration(order.totalMs),
          order.diffOnlyReviews === 0 ? String(order.reviewRounds) : `${order.reviewRounds}, ${order.diffOnlyReviews} diff only`,
          order.firstVerdict === null ? "-" : order.firstReviewDiffOnly ? `${order.firstVerdict}, diff only` : order.firstVerdict,
          String(order.blocks),
          String(order.retries),
          String(order.followUps),
          String(order.questions),
          String(order.runs),
          usd(order.spentUsd),
        ]),
      ),
    ].join("\n"),
    [
      "By author (the worker and model of an order's first writing run; a first review made from the diff alone is not counted)",
      table(
        ["author", "orders", "delivered", "approved first", "build", "cost per order"],
        stats.authors.map((author) => [
          author.author,
          String(author.orders),
          String(author.delivered),
          author.reviewed === 0 ? "-" : `${author.approvedFirst} of ${author.reviewed}`,
          formatDuration(author.medianBuildMs),
          usd(author.usdPerOrder),
        ]),
      ),
    ].join("\n"),
    [
      "Runs",
      table(
        ["role", "engine", "model", "runs", "unfinished", "time", "turns", "tokens in", "tokens out", "cost"],
        stats.runs.map((group) => [
          group.role,
          group.engine,
          group.model ?? "default",
          String(group.runs),
          String(group.unfinished),
          formatDuration(group.medianMs),
          count(group.medianTurns),
          count(group.usage?.inputTokens ?? null),
          count(group.usage?.outputTokens ?? null),
          usd(group.spentUsd),
        ]),
      ),
      "time and turns are medians of the runs that completed · a cost of - means the engine reported none",
    ].join("\n"),
  ];
  if (stats.blockReasons.length > 0) {
    sections.push(["Blocks", ...stats.blockReasons.map(({ reason, count: times }) => `${String(times).padStart(3)}  ${reason}`)].join("\n"));
  }
  if (stats.refusedAnswers > 0) sections.push(`Manager answers the service refused: ${stats.refusedAnswers}`);
  return sections.join("\n\n");
}
