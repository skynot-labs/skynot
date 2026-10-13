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
import type { EngineRequest, RoleEngine } from "../../src/execution";
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

async function openShop(): Promise<Shop> {
  const manager = createMockManager();
  const recorded: RoleEngine = { run: (request) => (asked.push(request), manager.run(request)), loginStatus: () => manager.loginStatus() };
  const shop = await createShop({
    policy: examplePolicy(),
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
