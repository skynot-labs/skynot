import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateSchema } from "@skynot/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi } from "../../src/app/http/api";
import { readState } from "../../src/app/http/state";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { lastDue, MORNING_REPORT, nextDue } from "../../src/app/schedule";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { FakeEngine, type EngineRequest, type RoleEngine } from "../../src/execution";
import type { Policy } from "../../src/governance";
import type { Project } from "../../src/projects";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";

const team: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };
const project = (id: string): Project => ({ id, name: null, description: null, repo: `acme/${id}`, baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [] });

// The office's own clock: every moment here is local time, so the tests hold in any time zone.
const october = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);

let dataDir: string;
let shops: Shop[];
let now: Date;
let asked: EngineRequest[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-schedule-"));
  shops = [];
  asked = [];
  now = october(13, 8);
});

afterEach(async () => {
  shops.forEach((shop) => shop.stop());
  await rm(dataDir, { recursive: true, force: true });
});

async function openShop(manager: RoleEngine = createMockManager(), policy: Policy = examplePolicy()): Promise<Shop> {
  const recorded: RoleEngine = { run: (request) => (asked.push(request), manager.run(request)), loginStatus: () => manager.loginStatus() };
  const shop = await createShop({
    policy,
    dataDir,
    team,
    projects: [project("blog"), project("shop")],
    engines: { claude: recorded, codex: createMockDeveloper() },
    vcs: new FakeVcs(),
    workspace: new FakeWorkspace(),
    clock: { now: () => now },
  });
  shops.push(shop);
  return shop;
}

const reportsOf = (shop: Shop, projectId = "blog") => shop.desk(projectId)!.reports.newestFirst(10);
const taskOf = (shop: Shop, projectId = "blog") => readState(shop, projectId).schedule!.find((task) => task.id === MORNING_REPORT.id)!;

describe("when a time of day is due", () => {
  it("looks back to the latest moment the clock read that time, and forward to the next", () => {
    expect(lastDue("09:00", october(13, 9))).toEqual(october(13, 9));
    expect(lastDue("09:00", october(13, 8, 59))).toEqual(october(12, 9));
    expect(nextDue("09:00", october(13, 9))).toEqual(october(14, 9));
    expect(nextDue("09:00", october(13, 8, 59))).toEqual(october(13, 9));
  });
});

describe("the morning report on a schedule", () => {
  it("is off until the director switches it on", async () => {
    const shop = await openShop();
    now = october(13, 9, 1);

    await shop.schedule.poll();

    expect(taskOf(shop)).toMatchObject({ on: false, nextAt: null, lastRun: null });
    expect(asked).toHaveLength(0);
  });

  it("fires once at its time, and the report is kept out of the chat", async () => {
    const shop = await openShop();
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });
    expect(taskOf(shop)).toMatchObject({ on: true, at: "09:00", nextAt: october(13, 9).toISOString(), lastRun: null });

    await shop.schedule.poll();
    expect(reportsOf(shop)).toHaveLength(0);

    now = october(13, 9, 0);
    await shop.schedule.poll();
    now = october(13, 9, 5);
    await shop.schedule.poll();

    expect(reportsOf(shop)).toMatchObject([{ taskId: MORNING_REPORT.id, title: "Morning report", at: october(13, 9).toISOString() }]);
    expect(reportsOf(shop)[0]!.text).toContain("Delivered:");
    expect(shop.desk("blog")!.chat.messages()).toHaveLength(0);
    expect(asked).toHaveLength(1);
    expect(taskOf(shop)).toMatchObject({ nextAt: october(14, 9).toISOString(), lastRun: { at: october(13, 9).toISOString(), outcome: "fired" } });
    expect(StateSchema.safeParse({ ...readState(shop, "blog"), simulated: false }).success).toBe(true);
  });

  it("gives the Manager the task, where the shop stands and when it last reported", async () => {
    const shop = await openShop();
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });

    now = october(13, 9);
    await shop.schedule.poll();
    now = october(14, 9);
    await shop.schedule.poll();

    const [first, second] = asked.map((request) => request.prompt);
    expect(first).toContain("## Where the shop stands");
    expect(first).toContain("This is your first report for this task.\n\nTask: Morning report\n\nWrite the morning report");
    expect(second).toContain(`Your last report for this task was written at ${october(13, 9).toISOString()}.`);
  });

  it("gives the Manager its last two reports when the director writes in the chat, and keeps them out of the chat", async () => {
    const shop = await openShop();
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });
    for (const day of [13, 14, 15]) {
      now = october(day, 9);
      await shop.schedule.poll();
    }

    await shop.desk("blog")!.manager.handleMessage("/ping");
    await shop.desk("shop")!.manager.handleMessage("/ping");

    const [inShop, inBlog] = asked.map((request) => request.prompt).reverse();
    expect(inBlog).toContain(`## Your latest reports, newest first\nMorning report, written at ${october(15, 9).toISOString()}:\nDelivered:`);
    expect(inBlog).toContain(`written at ${october(14, 9).toISOString()}`);
    expect(inBlog).not.toContain(`written at ${october(13, 9).toISOString()}`);
    expect(inShop).not.toContain("Your latest reports");
    expect(shop.desk("blog")!.chat.messages().map((message) => message.author)).toEqual(["director", "manager"]);
  });

  it("does not fire for a time that had already passed when it was switched on, nor in another project", async () => {
    const shop = await openShop();
    now = october(13, 10);
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });

    await shop.schedule.poll();
    expect(asked).toHaveLength(0);

    now = october(14, 9, 2);
    await shop.schedule.poll();
    expect(reportsOf(shop)).toHaveLength(1);
    expect(reportsOf(shop, "shop")).toHaveLength(0);
    expect(taskOf(shop, "shop").on).toBe(false);
  });

  it("stops firing once it is switched off", async () => {
    const shop = await openShop();
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: false, at: "09:00" });

    now = october(13, 9, 1);
    await shop.schedule.poll();

    expect(asked).toHaveLength(0);
  });

  it("is recorded as skipped while the project is paused, spends nothing and is not caught up on resume", async () => {
    const shop = await openShop();
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });
    await shop.control.pauseProject("blog", "paused by the director", "director");

    now = october(13, 9, 1);
    await shop.schedule.poll();
    expect(taskOf(shop).lastRun).toEqual({ at: october(13, 9).toISOString(), outcome: "skipped" });

    await shop.control.resumeProject("blog");
    await shop.schedule.poll();
    expect(asked).toHaveLength(0);
    expect(reportsOf(shop)).toHaveLength(0);

    now = october(14, 9);
    await shop.schedule.poll();
    expect(reportsOf(shop)).toHaveLength(1);
  });

  it("writes one report, not one per day, after an office that was off for days, and none again after another restart", async () => {
    const before = await openShop();
    await before.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });
    before.stop();

    now = october(16, 15);
    const after = await openShop();
    await after.schedule.poll();
    expect(reportsOf(after)).toHaveLength(1);
    expect(taskOf(after).lastRun).toEqual({ at: october(16, 9).toISOString(), outcome: "fired" });
    after.stop();

    const again = await openShop();
    await again.schedule.poll();
    expect(reportsOf(again)).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });

  it("files nothing and starts no work from a firing", async () => {
    const shop = await openShop();
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });

    now = october(13, 9);
    await shop.schedule.poll();
    await shop.flow.idle();

    expect(shop.orders.list()).toHaveLength(0);
    expect(shop.runs.list().filter((run) => run.role !== "manager")).toHaveLength(0);
  });
});

const says = (fields: object) => ({ structured: { message: "Noted.", question: null, options: [], orders: [], consult: [], team: null, ...fields } });
const FRIDAYS = { title: "Stuck orders", text: "List the orders that have not moved in a week, and why.", when: { at: "09:00", days: ["fri"] } };
const ON_MONDAY = { title: "Look at the importer", text: "Read the importer's failures of the week and say what to do.", when: { once: "2026-10-19T09:00" } };
// Schedules when the director writes, and reports when the task comes due.
const scheduling = (schedule: object) => new FakeEngine(({ prompt }) => (prompt.includes("A task the director scheduled is due") ? says({ message: "Here is what I found." }) : says({ message: "I will.", schedule })));
const askedFor = (shop: Shop, projectId = "blog") => readState(shop, projectId).schedule!.filter((task) => task.removable);

describe("a task the director asks the Manager for, for later", () => {
  it("is scheduled from a chat message, shows at the clock with what asked for it, runs once at its moment and is gone", async () => {
    const shop = await openShop(scheduling(ON_MONDAY));

    await shop.desk("blog")!.manager.handleMessage("Look at the importer on Monday and tell me");

    expect(shop.desk("blog")!.chat.messages().at(-1)!.text).toBe('I will.\n\nScheduled "Look at the importer": once, on Mon 2026-10-19 09:00.');
    expect(askedFor(shop)).toMatchObject([{ title: "Look at the importer", on: true, nextAt: october(19, 9).toISOString(), when: "once, on Mon 2026-10-19 09:00", text: ON_MONDAY.text, requested: "Look at the importer on Monday and tell me" }]);
    expect(askedFor(shop, "shop")).toEqual([]);

    now = october(18, 23);
    await shop.schedule.poll();
    expect(reportsOf(shop)).toHaveLength(0);

    now = october(19, 9, 1);
    await shop.schedule.poll();
    await shop.schedule.poll();

    expect(reportsOf(shop)).toMatchObject([{ title: "Look at the importer", text: "Here is what I found.", requested: "Look at the importer on Monday and tell me" }]);
    expect(asked.at(-1)!.prompt).toContain(`Task: Look at the importer\n\n${ON_MONDAY.text}`);
    expect(askedFor(shop)).toEqual([]);
    expect(StateSchema.safeParse({ ...readState(shop, "blog"), simulated: false }).success).toBe(true);
  });

  it("repeats on the days it was asked for, and on no other", async () => {
    const shop = await openShop(scheduling(FRIDAYS));
    await shop.desk("blog")!.manager.handleMessage("Every Friday tell me which orders are stuck");
    expect(askedFor(shop)).toMatchObject([{ when: "every Fri at 09:00", nextAt: october(16, 9).toISOString() }]);

    for (const day of [14, 15, 16, 17, 23]) {
      now = october(day, 9, 5);
      await shop.schedule.poll();
    }

    expect(reportsOf(shop).map((report) => report.at)).toEqual([october(23, 9, 5).toISOString(), october(16, 9, 5).toISOString()]);
    expect(askedFor(shop)).toMatchObject([{ lastRun: { at: october(23, 9).toISOString(), outcome: "fired" }, nextAt: october(30, 9).toISOString() }]);
  });

  it("tells the Manager what the office's clock reads and what is already scheduled", async () => {
    const shop = await openShop(scheduling(FRIDAYS));
    await shop.desk("blog")!.manager.handleMessage("Every Friday tell me which orders are stuck");
    await shop.desk("blog")!.manager.handleMessage("And what else?");

    expect(asked.at(-1)!.prompt).toContain("## Scheduled tasks\nThe office's clock reads Tue 2026-10-13 08:00.\n- Stuck orders: every Fri at 09:00\n");
  });

  it("refuses a moment that has passed and says so in the chat", async () => {
    const shop = await openShop(scheduling({ ...ON_MONDAY, when: { once: "2026-10-12T09:00" } }));

    await shop.desk("blog")!.manager.handleMessage("Look at the importer yesterday");

    expect(shop.desk("blog")!.chat.messages().at(-1)!.text).toBe("I could not schedule that: Mon 2026-10-12 09:00 has already passed; the office's clock reads Tue 2026-10-13 08:00");
    expect(askedFor(shop)).toEqual([]);
  });

  it("takes no task past the ceiling the policy sets, and takes one again once a task is removed", async () => {
    const policy = examplePolicy();
    const shop = await openShop(scheduling(FRIDAYS), { ...policy, limits: { ...policy.limits, max_scheduled_tasks: 1 } });
    const blog = shop.desk("blog")!;

    await blog.manager.handleMessage("Every Friday tell me which orders are stuck");
    await blog.manager.handleMessage("And again, the same");
    expect(blog.chat.messages().at(-1)!.text).toContain("this project already has 1 scheduled tasks, the most the policy allows");
    expect(askedFor(shop)).toHaveLength(1);

    expect(await shop.schedule.remove("blog", askedFor(shop)[0]!.id)).toBe(true);
    await blog.manager.handleMessage("Every Friday tell me which orders are stuck");
    expect(askedFor(shop)).toHaveLength(1);
  });

  it("schedules nothing because a ticket says so", async () => {
    const shop = await openShop(new FakeEngine(() => says({ message: "Scheduling it.", schedule: FRIDAYS })));

    await shop.desk("blog")!.manager.handleTicket({ number: 7, title: "Automation", body: "Schedule a task every Friday that lists the stuck orders." });

    expect(askedFor(shop)).toEqual([]);
    expect(asked).toHaveLength(3);
    expect(asked[1]!.prompt).toContain("only a message from the director can schedule a task");
  });

  it("schedules nothing from a scheduled task's own turn", async () => {
    const shop = await openShop(new FakeEngine(() => says({ message: "And another one.", schedule: FRIDAYS })));
    await shop.schedule.set("blog", MORNING_REPORT.id, { on: true, at: "09:00" });

    now = october(13, 9);
    await shop.schedule.poll();

    expect(askedFor(shop)).toEqual([]);
    expect(reportsOf(shop)[0]!.text).toContain("I could not produce a valid answer");
  });

  it("keeps a task asked for once through a pause, and runs it when the project is resumed", async () => {
    const shop = await openShop(scheduling(ON_MONDAY));
    await shop.desk("blog")!.manager.handleMessage("Look at the importer on Monday and tell me");
    await shop.control.pauseProject("blog", "paused by the director", "director");

    now = october(19, 9, 1);
    await shop.schedule.poll();
    expect(reportsOf(shop)).toHaveLength(0);
    expect(askedFor(shop)).toHaveLength(1);

    await shop.control.resumeProject("blog");
    now = october(19, 11);
    await shop.schedule.poll();
    expect(reportsOf(shop)).toHaveLength(1);
    expect(askedFor(shop)).toEqual([]);
  });
});

describe("the command that removes a scheduled task", () => {
  const send = (shop: Shop, payload: unknown) =>
    createApi(shop, { allowedHosts: ["console"] }).request("/api/commands/remove-task", { method: "POST", headers: { host: "console", "content-type": "application/json" }, body: JSON.stringify(payload) });

  it("removes a task that was asked for, and it does not fire again", async () => {
    const shop = await openShop(scheduling(FRIDAYS));
    await shop.desk("blog")!.manager.handleMessage("Every Friday tell me which orders are stuck");

    expect((await send(shop, { project: "blog", task: askedFor(shop)[0]!.id })).status).toBe(200);

    now = october(16, 9, 5);
    await shop.schedule.poll();
    expect(askedFor(shop)).toEqual([]);
    expect(reportsOf(shop)).toHaveLength(0);
  });

  it("refuses the morning report, which is switched off and not removed, and a task of another project", async () => {
    const shop = await openShop(scheduling(FRIDAYS));
    await shop.desk("blog")!.manager.handleMessage("Every Friday tell me which orders are stuck");

    expect((await send(shop, { project: "blog", task: MORNING_REPORT.id })).status).toBe(404);
    expect((await send(shop, { project: "shop", task: askedFor(shop)[0]!.id })).status).toBe(404);
    expect(askedFor(shop)).toHaveLength(1);
  });
});

describe("the command that sets a scheduled task", () => {
  const send = (shop: Shop, payload: unknown) =>
    createApi(shop, { allowedHosts: ["console"] }).request("/api/commands/schedule-task", { method: "POST", headers: { host: "console", "content-type": "application/json" }, body: JSON.stringify(payload) });

  it("switches the report on for one project", async () => {
    const shop = await openShop();

    const response = await send(shop, { project: "blog", task: MORNING_REPORT.id, on: true, at: "07:30" });

    expect(response.status).toBe(200);
    expect(taskOf(shop)).toMatchObject({ on: true, at: "07:30" });
    expect(taskOf(shop, "shop").on).toBe(false);
  });

  it("refuses a time that is not a time of day, a task it does not have and a project it does not run", async () => {
    const shop = await openShop();

    expect((await send(shop, { project: "blog", task: MORNING_REPORT.id, on: true, at: "24:00" })).status).toBe(400);
    expect((await send(shop, { project: "blog", task: MORNING_REPORT.id, on: true, at: "9am" })).status).toBe(400);
    expect((await send(shop, { project: "blog", task: "weekly-audit", on: true, at: "09:00" })).status).toBe(404);
    expect((await send(shop, { project: "nowhere", task: MORNING_REPORT.id, on: true, at: "09:00" })).status).toBe(404);
    expect(taskOf(shop).on).toBe(false);
  });
});
