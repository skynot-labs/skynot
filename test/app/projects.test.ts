import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeliveryRules } from "../../src/app/delivery-rules";
import { projectsFromPolicy, readProjects } from "../../src/app/projects";
import { ActionBudget, ActionCounts } from "../../src/governance";
import { fixedClock } from "../../src/kernel";
import { EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { YamlTeamRepository } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(tmpdir(), "skynot-app-projects-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

const yaml = (repo: string) => `version: 1\nrepo: ${repo}\nbase_branch: develop\nsetup_command: null\nverify_commands: ["make test"]\nprotected_paths: ["infra/"]\n`;

describe("reading the projects", () => {
  it("uses the projects folder when it exists", async () => {
    await mkdir(path.join(dir, "blog"));
    await writeFile(path.join(dir, "blog", "project.yaml"), yaml("acme/blog"));

    expect(await readProjects(examplePolicy(), false, dir)).toMatchObject([{ id: "blog", repo: "acme/blog", baseBranch: "develop" }]);
  });

  it("falls back to the repository listed in policy.yaml, so an existing shop keeps working", async () => {
    expect(await readProjects(examplePolicy(), false, path.join(dir, "none"))).toMatchObject([{ id: "widgets", repo: "acme/widgets" }]);
  });

  it("stops with a message that says what to add when there is no project at all", async () => {
    await expect(readProjects({ ...examplePolicy(), repos: [] }, false, path.join(dir, "none"))).rejects.toThrow("projects.example");
  });

  it("refuses to start on the placeholder repository of the shipped example", async () => {
    const policy = { ...examplePolicy(), repos: [{ ...examplePolicy().repos[0]!, name: "OWNER/REPO" }] };

    await expect(readProjects(policy, false, path.join(dir, "none"))).rejects.toThrow("OWNER/REPO");
  });

  it("refuses two projects on the same repository, since the rules are looked up by repository", async () => {
    for (const id of ["blog", "blog-two"]) {
      await mkdir(path.join(dir, id));
      await writeFile(path.join(dir, id, "project.yaml"), yaml("acme/blog"));
    }

    await expect(readProjects(examplePolicy(), false, dir)).rejects.toThrow("a repository belongs to one project");
  });

  it("gives the simulated shop a demo project of its own", async () => {
    expect(await readProjects({ ...examplePolicy(), repos: [] }, true, path.join(dir, "none"))).toMatchObject([{ id: "demo" }]);
  });
});

describe("delivery rules by project", () => {
  const rules = () => {
    const policy = examplePolicy();
    const clock = fixedClock(new Date("2026-10-11T12:00:00.000Z"));
    const budget = new ActionBudget(policy, new EventLog(new InMemoryEventStore(), clock), new ActionCounts(), clock);
    return createDeliveryRules(policy, budget, [
      { id: "blog", repo: "acme/blog", baseBranch: "develop", setupCommand: null, verifyCommands: ["make test"], protectedPaths: ["infra/"] },
      ...projectsFromPolicy(policy),
    ]);
  };

  it("answers for each project's repository with its own rules, and refuses one that belongs to none", () => {
    expect(rules().repo("acme/blog")).toMatchObject({ ok: true, value: { baseBranch: "develop", verifyCommands: ["make test"] } });
    expect(rules().repo("acme/widgets")).toMatchObject({ ok: true, value: { baseBranch: "main" } });
    expect(rules().repo("acme/other")).toMatchObject({ ok: false, error: expect.stringContaining("belongs to no project") });
  });

  it("protects each project's own paths, and everything for a repository that belongs to none", () => {
    expect(rules().protectedTouched("acme/blog", ["infra/main.tf", "src/a.ts"])).toEqual(["infra/main.tf"]);
    expect(rules().protectedTouched("acme/widgets", ["infra/main.tf"])).toEqual([]);
    expect(rules().protectedTouched("acme/other", ["src/a.ts"])).toEqual(["src/a.ts"]);
  });
});

describe("team of a project", () => {
  const team = (engine: string) => `version: 1\nroles:\n  manager: { engine: ${engine} }\n  developer: { engine: ${engine} }\n`;

  it("uses the project's own team.yaml, and the shop's for a project without one", async () => {
    await mkdir(path.join(dir, "blog"));
    await writeFile(path.join(dir, "blog", "team.yaml"), team("codex"));
    await writeFile(path.join(dir, "shared.yaml"), team("claude"));
    const teams = new YamlTeamRepository(dir, path.join(dir, "shared.yaml"));

    expect(await teams.forProject("blog")).toMatchObject({ ok: true, value: { roles: { manager: { engine: "codex" } } } });
    expect(await teams.forProject("docs")).toMatchObject({ ok: true, value: { roles: { manager: { engine: "claude" } } } });
  });
});
