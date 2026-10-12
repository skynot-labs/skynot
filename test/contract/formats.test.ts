import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  BRIEFING_CHANGE_ID,
  MAX_FOCUS,
  MAX_PREFERENCE_BYTES,
  MAX_PROJECT_DESCRIPTION,
  MAX_PROJECT_NAME,
  MIN_FOCUS,
  MINUTES_BUCKETS,
  ORDER_ID,
  PROJECT_ID,
  REPOSITORY,
  ROLE_NAME,
  RUN_ID,
  TEAM_CHANGE_ID,
} from "@skynot/contract";
import * as preferences from "../../src/app/preferences";
import { newId } from "../../src/kernel";
import { createAnswerSchema } from "../../src/manager";
import { WorkOrderSpecSchema, formatOrderId, type MinutesBucket } from "../../src/orders";
import * as projects from "../../src/projects";
import { TeamFileSchema } from "../../src/team";

const samePattern = (contract: RegExp, office: RegExp) => expect([contract.source, contract.flags]).toEqual([office.source, office.flags]);

describe("the wire formats of the contract and the office's own rules", () => {
  it("name a project the same way", () => {
    samePattern(PROJECT_ID, projects.PROJECT_ID);
    expect(MAX_PROJECT_NAME).toBe(projects.MAX_PROJECT_NAME);
    expect(MAX_PROJECT_DESCRIPTION).toBe(projects.MAX_PROJECT_DESCRIPTION);
  });

  it("size a preference the same way", () => {
    expect(MAX_PREFERENCE_BYTES).toBe(preferences.MAX_PREFERENCE_BYTES);
  });

  it("accept the same repositories as a project file", () => {
    const file = (repo: string) => ({ version: 1, repo, base_branch: "main", setup_command: null, verify_commands: ["npm test"], protected_paths: [] });

    expect(projects.ProjectFileSchema.safeParse(file("acme/widgets")).success).toBe(true);
    for (const repo of ["acme/widgets", "a.b-c_d/e.f", "acme", "acme/widgets/extra", "acme widgets/x", "/widgets", "acme/"]) {
      expect([repo, REPOSITORY.test(repo)]).toEqual([repo, projects.ProjectFileSchema.safeParse(file(repo)).success]);
    }
  });

  it("accept the order ids the office hands out and the ones an order may depend on", () => {
    const spec = (dependsOn: string) => ({
      title: "Export",
      summary: "Export the inventory to a file",
      objective: "Export the inventory to CSV",
      acceptanceCriteria: [{ statement: "The file has a header", verification: { kind: "test", detail: "a unit test" } }],
      outOfScope: [],
      risk: "low",
      likelyFiles: [],
      dependsOn: [dependsOn],
    });

    for (const number of [1, 42, 9999]) expect(formatOrderId(number)).toMatch(ORDER_ID);
    expect(WorkOrderSpecSchema.safeParse(spec("WO-0001")).success).toBe(true);
    for (const id of ["WO-0001", "WO-1", "WO-00001", "wo-0001", "WO-000a", " WO-0001"]) {
      expect([id, ORDER_ID.test(id)]).toEqual([id, WorkOrderSpecSchema.safeParse(spec(id)).success]);
    }
  });

  it("accept the role names a team file may list", () => {
    const team = (worker: string) => ({ version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, workers: { [worker]: { engine: "claude" } } });

    expect(TeamFileSchema.safeParse(team("qa")).success).toBe(true);
    for (const name of ["qa", "front-end", "a", "x".repeat(24), "x".repeat(25), "Designer", "9lives", "code_reviewer", "qa "]) {
      expect([name, ROLE_NAME.test(name)]).toEqual([name, TeamFileSchema.safeParse(team(name)).success]);
    }
  });

  it("bound a focus the way the Manager's own proposals are bound", () => {
    const answers = createAnswerSchema(z.unknown(), [], { hire: [], dismiss: [], refocus: ["designer"] });
    const refocus = (length: number) =>
      answers.safeParse({ message: "A new focus.", question: null, options: [], consult: [], team: { action: "refocus", role: "designer", reason: "The work changed", focus: "x".repeat(length) } }).success;

    expect([MIN_FOCUS - 1, MIN_FOCUS, MAX_FOCUS, MAX_FOCUS + 1].map(refocus)).toEqual([false, true, true, false]);
  });

  it("recognise the ids the office mints for runs, team changes and briefing changes", () => {
    expect(newId("run")).toMatch(RUN_ID);
    expect(newId("chg")).toMatch(TEAM_CHANGE_ID);
    expect(newId("brf")).toMatch(BRIEFING_CHANGE_ID);
    expect(newId("chg")).not.toMatch(BRIEFING_CHANGE_ID);
  });

  it("offer the same answers to how long a review took", () => {
    expectTypeOf<(typeof MINUTES_BUCKETS)[number]>().toEqualTypeOf<MinutesBucket>();
  });
});
