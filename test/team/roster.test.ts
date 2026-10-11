import { describe, expect, it } from "vitest";
import { fixedClock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { RosterProjection, TeamService, type Advisor } from "../../src/team";

const advisor = (description: string): Advisor => ({ engine: "claude", description, soul: `soul of ${description}` });
const universe = {
  advisors: { architect: advisor("design"), reviewer: advisor("scope") },
  library: { designer: advisor("screens") },
};

async function openTeam(store = new InMemoryEventStore()) {
  const log = new EventLog(store, fixedClock(new Date("2026-10-11T12:00:00.000Z")));
  const roster = new RosterProjection(universe);
  await attachProjection(log, roster);
  return { service: new TeamService(log, roster), roster, store };
}

const names = (roster: RosterProjection) => Object.keys(roster.members());
const propose = async (team: Awaited<ReturnType<typeof openTeam>>, action: "hire" | "dismiss" | "refocus", role: string, focus?: string) => {
  const proposed = await team.service.propose({ action, role, reason: "because", ...(focus && { focus }) });
  if (!proposed.ok) throw new Error(proposed.error.message);
  return proposed.value.id;
};

describe("roster", () => {
  it("starts with the advisors of the team file, and offers the library for hire", async () => {
    const { roster } = await openTeam();

    expect(names(roster)).toEqual(["architect", "reviewer"]);
    expect(roster.hireable()).toEqual([{ name: "designer", description: "screens" }]);
  });

  it("changes nothing until the director signs", async () => {
    const team = await openTeam();

    const id = await propose(team, "hire", "designer");

    expect(names(team.roster)).toEqual(["architect", "reviewer"]);
    expect(team.roster.pending().map((change) => [change.id, change.action, change.role])).toEqual([[id, "hire", "designer"]]);
  });

  it("hires on signature and the new member carries its soul", async () => {
    const team = await openTeam();
    const id = await propose(team, "hire", "designer");

    const signed = await team.service.sign(id);

    expect(signed).toMatchObject({ ok: true, value: { status: "signed" } });
    expect(names(team.roster)).toEqual(["architect", "reviewer", "designer"]);
    expect(team.roster.members().designer?.soul).toBe("soul of screens");
    expect(team.roster.pending()).toEqual([]);
    expect(team.roster.hireable()).toEqual([]);
  });

  it("dismisses on signature, and a dismissed advisor of the file can be hired back", async () => {
    const team = await openTeam();
    await team.service.sign(await propose(team, "dismiss", "reviewer"));
    expect(names(team.roster)).toEqual(["architect"]);
    expect(team.roster.hireable().map((role) => role.name).sort()).toEqual(["designer", "reviewer"]);

    await team.service.sign(await propose(team, "hire", "reviewer"));

    expect(names(team.roster).sort()).toEqual(["architect", "reviewer"]);
  });

  it("leaves the team alone when the proposal is discarded", async () => {
    const team = await openTeam();
    const id = await propose(team, "hire", "designer");

    const discarded = await team.service.discard(id);

    expect(discarded).toMatchObject({ ok: true, value: { status: "discarded" } });
    expect(names(team.roster)).toEqual(["architect", "reviewer"]);
    expect(team.roster.pending()).toEqual([]);
  });

  it("refuses to discard a change twice, or to sign one that was discarded", async () => {
    const team = await openTeam();
    const id = await propose(team, "hire", "designer");
    await team.service.discard(id);

    expect(await team.service.discard(id)).toMatchObject({ ok: false, error: { kind: "invalid", message: `${id} is already discarded` } });
    expect(await team.service.sign(id)).toMatchObject({ ok: false, error: { kind: "invalid" } });
    expect(names(team.roster)).toEqual(["architect", "reviewer"]);
  });

  it.each([
    ["hiring someone who is already on the team", "hire", "architect"],
    ["hiring someone who is not in the library", "hire", "oracle"],
    ["dismissing someone who is not on the team", "dismiss", "designer"],
  ] as const)("refuses %s", async (_name, action, role) => {
    const team = await openTeam();

    expect(await team.service.propose({ action, role, reason: "because" })).toMatchObject({ ok: false, error: { kind: "invalid" } });
    expect(team.roster.pending()).toEqual([]);
  });

  it("refuses a second pending change for the same role", async () => {
    const team = await openTeam();
    await propose(team, "hire", "designer");

    expect(await team.service.propose({ action: "hire", role: "designer", reason: "again" })).toMatchObject({ ok: false });
  });

  it("refuses to sign twice, to sign an unknown change, and to sign what no longer applies", async () => {
    const team = await openTeam();
    const first = await propose(team, "dismiss", "reviewer");
    expect(await team.service.sign(first)).toMatchObject({ ok: true });

    expect(await team.service.sign(first)).toMatchObject({ ok: false, error: { kind: "invalid" } });
    expect(await team.service.sign("chg_nope")).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(names(team.roster)).toEqual(["architect"]);
  });

  it("rebuilds the same team from the log after a restart", async () => {
    const first = await openTeam();
    await first.service.sign(await propose(first, "hire", "designer"));
    await first.service.sign(await propose(first, "dismiss", "architect"));
    await propose(first, "dismiss", "reviewer");

    const restarted = await openTeam(first.store);

    expect(names(restarted.roster)).toEqual(["reviewer", "designer"]);
    expect(restarted.roster.pending().map((change) => change.role)).toEqual(["reviewer"]);
  });
});

describe("changing what a member concentrates on", () => {
  it("adds the focus to the soul only once signed, and keeps it after a restart", async () => {
    const team = await openTeam();
    const id = await propose(team, "refocus", "architect", "accessibility of every screen");
    expect(team.roster.members().architect?.soul).toBe("soul of design");
    expect(team.roster.pending()).toMatchObject([{ action: "refocus", focus: "accessibility of every screen" }]);

    await team.service.sign(id);
    expect(team.roster.members().architect?.soul).toBe("soul of design\n\nFocus the director set for this role: accessibility of every screen");
    expect(names(team.roster)).toEqual(["architect", "reviewer"]);

    const restarted = await openTeam(team.store);
    expect(restarted.roster.members().architect?.soul).toContain("accessibility of every screen");
    expect(restarted.roster.members().reviewer?.soul).toBe("soul of scope");
  });

  it("refuses to refocus someone who is not on the team, or without saying the focus", async () => {
    const team = await openTeam();

    expect(await team.service.propose({ action: "refocus", role: "designer", reason: "x", focus: "colors" })).toMatchObject({ ok: false, error: { message: expect.stringContaining("not on the team") } });
    expect(await team.service.propose({ action: "refocus", role: "architect", reason: "x" })).toMatchObject({ ok: false, error: { message: "a refocus needs the new focus" } });
  });

  it("replaces an earlier focus with the next one signed", async () => {
    const team = await openTeam();
    await team.service.sign(await propose(team, "refocus", "architect", "first"));
    await team.service.sign(await propose(team, "refocus", "architect", "second"));

    expect(team.roster.members().architect?.soul).toContain("second");
    expect(team.roster.members().architect?.soul).not.toContain("first");
  });
});
