import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActivityProjection } from "../../src/app/activity";
import { answeredOf, inboxOf } from "../../src/app/inbox";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { fixedClock, type Clock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import type { Project } from "../../src/projects";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

let dataDir: string;
let shops: Shop[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-inbox-"));
  shops = [];
});

afterEach(async () => {
  shops.forEach((shop) => shop.stop());
  await rm(dataDir, { recursive: true, force: true });
});

const project = (id: string): Project => ({ id, name: null, description: null, repo: `acme/${id}`, baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [".github/"] });
const team: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };

function tickingClock(): Clock {
  let seconds = 0;
  return { now: () => new Date(Date.UTC(2026, 9, 9, 12, 0, seconds++)) };
}

async function openShop(): Promise<Shop> {
  const shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team,
    projects: [project("blog"), project("shop")],
    engines: { claude: createMockManager(), codex: createMockDeveloper() },
    vcs: new FakeVcs(),
    workspace: new FakeWorkspace(),
    clock: tickingClock(),
  });
  shops.push(shop);
  return shop;
}

async function proposeIn(shop: Shop, projectId: string, ticket?: number): Promise<string> {
  const proposed = await shop.orderService.propose(validSpec(), { projectId, ...(ticket && { ticket }) });
  if (!proposed.ok) throw new Error(proposed.error.message);
  return proposed.value.id;
}

interface Times {
  orderId: string;
  at: Record<string, string>;
}

async function answerEverythingInTheBlog(shop: Shop): Promise<Times> {
  const orderId = await proposeIn(shop, "blog", 7);
  const at: Record<string, string> = {};
  const record = async (step: string, type: string, payload: Record<string, unknown>) => {
    const [stored] = await shop.log.record([{ type, payload: { ...payload, projectId: "blog" } }]);
    at[step] = stored!.occurredAt;
  };
  await record("scope asked", "manager.decision_asked", { decisionId: "dec_scope", question: "Full posts or summaries?", options: ["Full", "Summaries"] });
  await record("format asked", "delivery.question_raised", { orderId, question: "Atom or RSS 2.0?" });
  await record("ticket asked", "manager.decision_asked", { decisionId: "dec_ticket", question: "What does ticket #9 want?", options: [], ticket: 9 });
  await record("format answered", "delivery.question_answered", { orderId, answer: "RSS 2.0" });
  await record("ticket answered", "manager.decision_answered", { decisionId: "dec_ticket", answer: "A dark theme" });
  await record("count asked", "delivery.question_raised", { orderId, question: "How many items?" });
  await record("scope answered", "manager.decision_answered", { decisionId: "dec_scope", answer: "Summaries" });
  await record("count answered", "delivery.question_answered", { orderId, answer: "Twenty" });
  await record("friday asked", "manager.decision_asked", { decisionId: "dec_open", question: "Ship on Friday?", options: [] });
  return { orderId, at };
}

describe("the history of answered questions", () => {
  it("merges what the Manager and the workers asked, the newest answer first", async () => {
    const shop = await openShop();
    const { orderId, at } = await answerEverythingInTheBlog(shop);

    expect(new Set(Object.values(at)).size).toBe(9);
    expect(answeredOf(shop, "blog")).toEqual([
      { id: `question:${orderId}:2`, kind: "worker_question", from: "developer", question: "How many items?", answer: "Twenty", orderId, ticket: 7, askedAt: at["count asked"], answeredAt: at["count answered"] },
      { id: "dec_scope", kind: "manager_question", from: "manager", question: "Full posts or summaries?", answer: "Summaries", orderId: null, ticket: null, askedAt: at["scope asked"], answeredAt: at["scope answered"] },
      { id: "dec_ticket", kind: "ticket_doubt", from: "manager", question: "What does ticket #9 want?", answer: "A dark theme", orderId: null, ticket: 9, askedAt: at["ticket asked"], answeredAt: at["ticket answered"] },
      { id: `question:${orderId}:1`, kind: "worker_question", from: "developer", question: "Atom or RSS 2.0?", answer: "RSS 2.0", orderId, ticket: 7, askedAt: at["format asked"], answeredAt: at["format answered"] },
    ]);
  });

  it("keeps only the newest answers when there are more than the limit", async () => {
    const shop = await openShop();
    await answerEverythingInTheBlog(shop);

    expect(answeredOf(shop, "blog", 2).map((item) => item.answer)).toEqual(["Twenty", "Summaries"]);
    expect(answeredOf(shop, "blog", 0)).toEqual([]);
  });

  it("shows nothing of one project in another, and nothing for a project that does not exist", async () => {
    const shop = await openShop();
    await answerEverythingInTheBlog(shop);
    await proposeIn(shop, "shop");

    expect(answeredOf(shop, "shop")).toEqual([]);
    expect(answeredOf(shop, "ghost")).toEqual([]);
  });

  it("leaves in the inbox only what still waits for an answer", async () => {
    const shop = await openShop();
    await answerEverythingInTheBlog(shop);

    expect(inboxOf(shop, "blog").map((item) => [item.id, item.kind])).toEqual([["dec_open", "manager_question"]]);
    expect(answeredOf(shop, "blog").map((item) => item.id)).not.toContain("dec_open");
  });

  it("tells the same history after a restart, from the log already on disk", async () => {
    const shop = await openShop();
    await answerEverythingInTheBlog(shop);
    const before = answeredOf(shop, "blog");
    shop.stop();

    const reopened = await openShop();

    expect(before).toHaveLength(4);
    expect(answeredOf(reopened, "blog")).toEqual(before);
  });
});

describe("the logbook of a project", () => {
  it("files a pause, a resume, a registration and a new description under the project they are about", async () => {
    const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-09T12:00:00.000Z")));
    const activity = new ActivityProjection("blog");
    await attachProjection(log, activity);

    await log.record([
      { type: "control.project_paused", payload: { projectId: "shop", reason: "the budget ran out" } },
      { type: "control.project_resumed", payload: { projectId: "shop" } },
      { type: "projects.registered", payload: { projectId: "shop" } },
      { type: "projects.described", payload: { projectId: "shop" } },
      { type: "control.paused", payload: { reason: "maintenance" } },
    ]);

    expect(activity.recent(10, "shop").map((entry) => [entry.kind, entry.text, entry.orderId])).toEqual([
      ["run", "project name and description changed", null],
      ["run", "project registered; it starts with the next restart", null],
      ["run", "project resumed", null],
      ["run", "project paused: the budget ran out", null],
    ]);
    expect(activity.recent(10, "blog").map((entry) => entry.text)).toEqual(["the shop was paused: maintenance"]);
  });

  it("names what a run cost only when its engine reported it, also for a log that recorded codex as zero", async () => {
    const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-09T12:00:00.000Z")));
    const activity = new ActivityProjection("blog");
    await attachProjection(log, activity);
    const finish = async (role: string, engine: string, costUsd: number | null) => {
      await log.record([{ type: "execution.run_requested", payload: { runId: `run_${role}`, role, engine, access: "read", orderId: null, projectId: "blog" } }]);
      await log.record([{ type: "execution.run_completed", payload: { runId: `run_${role}`, costUsd } }]);
    };

    await finish("developer", "codex", 0);
    await finish("reviewer", "codex", null);
    await finish("architect", "claude", 0);
    await finish("manager", "claude", 1.5);

    expect(activity.recent(10, "blog").map((entry) => entry.text)).toEqual([
      "manager run finished, $1.50",
      "architect run finished, $0.00",
      "reviewer run finished",
      "developer run finished",
    ]);
  });
});
