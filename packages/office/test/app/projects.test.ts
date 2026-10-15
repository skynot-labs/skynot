import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeliveryRules } from "../../src/app/delivery-rules";
import { projectsFolder, projectsFromPolicy, readProjects, registrationProblem } from "../../src/app/projects";
import { ActionBudget, ActionCounts } from "../../src/governance";
import { fixedClock } from "../../src/kernel";
import { EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { exec, run } from "../../src/kernel/process";
import { YamlProjectRegistry, type Project } from "../../src/projects";
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

  it("keeps the project policy.yaml named first as the first, whatever the folders are called", async () => {
    for (const [name, repo] of [["alpha", "acme/alpha"], ["widgets", "acme/widgets"]] as const) {
      await mkdir(path.join(dir, name));
      await writeFile(path.join(dir, name, "project.yaml"), yaml(repo));
    }

    expect((await readProjects(examplePolicy(), false, dir)).map((project) => project.id)).toEqual(["widgets", "alpha"]);
  });

  it("uses policy.yaml when the folder holds only things that are not projects", async () => {
    await mkdir(path.join(dir, "some-app"));
    await writeFile(path.join(dir, "some-app", "package.json"), "{}");

    expect(await readProjects(examplePolicy(), false, dir)).toMatchObject([{ id: "widgets" }]);
  });

  it("falls back to the repository listed in policy.yaml, so an existing shop keeps working", async () => {
    expect(await readProjects(examplePolicy(), false, path.join(dir, "none"))).toMatchObject([{ id: "widgets", repo: "acme/widgets" }]);
  });

  it("refuses a repository in policy.yaml whose name cannot be a project id, instead of showing a project no command accepts", () => {
    const policy = examplePolicy();
    const dotted = { ...policy, repos: [{ ...policy.repos[0]!, name: "acme/my.repo" }] };

    expect(() => projectsFromPolicy(dotted)).toThrow("policy.yaml lists acme/my.repo, whose name cannot be a project id");
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

describe("registering a project in a running shop", () => {
  const project = (id: string, repo: string): Project => ({ id, name: null, description: null, repo, baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [] });
  const fromFolder = { dir: "projects", holdsProjects: true };
  const noFolder = { dir: "projects", holdsProjects: false };
  const pinned = [project("widgets", "acme/widgets"), project("blog", "acme/blog")];

  it("accepts a new id on a new repository, anywhere in the order when policy.yaml pins the first project", () => {
    expect(registrationProblem({ id: "alpha", repo: "acme/alpha" }, pinned, fromFolder, ["acme/widgets"])).toBeNull();
    expect(registrationProblem({ id: "zeta", repo: "acme/zeta" }, [project("blog", "acme/blog")], fromFolder, [])).toBeNull();
  });

  it("refuses an id already used and a repository another project serves, whatever its case", () => {
    expect(registrationProblem({ id: "blog", repo: "acme/other" }, pinned, fromFolder, ["acme/widgets"])).toContain("already a project called blog");
    expect(registrationProblem({ id: "journal", repo: "Acme/Blog" }, pinned, fromFolder, ["acme/widgets"])).toContain("acme/blog already belongs to the project blog");
  });

  it("refuses the first folder while the shop runs from policy.yaml or the demo, saying the current project would vanish", () => {
    const fromPolicy = registrationProblem({ id: "blog", repo: "acme/blog" }, [project("widgets", "acme/widgets")], noFolder, ["acme/widgets"]);
    const fromDemo = registrationProblem({ id: "blog", repo: "acme/blog" }, [project("demo", "demo/todo")], noFolder, ["acme/widgets"]);

    expect(fromPolicy).toContain("widgets would vanish");
    expect(fromPolicy).toContain("policy.yaml");
    expect(fromPolicy).toContain("Create projects/<id>/project.yaml for each current project first");
    expect(fromDemo).toContain("the simulated demo");
    expect(fromDemo).toContain("demo would vanish");
  });

  it("refuses a newcomer that would become the first project and inherit the history recorded before projects existed", () => {
    const unpinned = [project("blog", "acme/blog"), project("docs", "acme/docs")];

    expect(registrationProblem({ id: "alpha", repo: "acme/alpha" }, unpinned, fromFolder, ["acme/gone"])).toContain("Choose an id that sorts after blog");
    expect(registrationProblem({ id: "alpha", repo: "acme/alpha" }, unpinned, fromFolder, [])).toContain("would become the first project");
    expect(registrationProblem({ id: "zeta", repo: "acme/gone" }, unpinned, fromFolder, ["acme/gone"])).toContain("policy.yaml names acme/gone first");
    expect(registrationProblem({ id: "cms", repo: "acme/cms" }, unpinned, fromFolder, ["acme/gone"])).toBeNull();
  });

  it("agrees with what the next start really does: an accepted project is listed and the first project stays first", async () => {
    for (const [name, repo] of [["blog", "acme/blog"], ["docs", "acme/docs"]] as const) {
      await mkdir(path.join(dir, name));
      await writeFile(path.join(dir, name, "project.yaml"), yaml(repo));
    }
    const policy = { ...examplePolicy(), repos: [] };
    const current = await readProjects(policy, false, dir);
    const registry = new YamlProjectRegistry(dir);
    const file = (repo: string) => ({ version: 1 as const, repo, base_branch: "main", setup_command: null, verify_commands: ["npm test"], protected_paths: [] });

    expect(registrationProblem({ id: "cms", repo: "acme/cms" }, current, await projectsFolder(dir), [])).toBeNull();
    expect(await registry.register("cms", { ...file("acme/cms"), name: "The CMS" })).toMatchObject({ ok: true });
    expect((await readProjects(policy, false, dir)).map((listed) => [listed.id, listed.name])).toEqual([["blog", null], ["cms", "The CMS"], ["docs", null]]);

    expect(registrationProblem({ id: "alpha", repo: "acme/alpha" }, current, await projectsFolder(dir), [])).not.toBeNull();
    await registry.register("alpha", file("acme/alpha"));
    expect((await readProjects(policy, false, dir))[0]).toMatchObject({ id: "alpha" });
  });

  it("sees a shop that runs from policy.yaml as one whose folder holds no project, even when the folder exists", async () => {
    await mkdir(path.join(dir, "some-app"));
    const current = await readProjects(examplePolicy(), false, dir);

    expect(await projectsFolder(dir)).toEqual({ dir, holdsProjects: false });
    expect(await projectsFolder(path.join(dir, "none"))).toEqual({ dir: path.join(dir, "none"), holdsProjects: false });
    expect(registrationProblem({ id: "blog", repo: "acme/blog" }, current, await projectsFolder(dir), ["acme/widgets"])).toContain("widgets would vanish");

    await new YamlProjectRegistry(dir).register("blog", { version: 1, repo: "acme/blog", base_branch: "main", setup_command: null, verify_commands: ["npm test"], protected_paths: [] });
    expect((await readProjects(examplePolicy(), false, dir)).map((listed) => listed.id)).toEqual(["blog"]);
    expect(await projectsFolder(dir)).toEqual({ dir, holdsProjects: true });
  });
});

describe("delivery rules by project", () => {
  const rules = () => {
    const policy = examplePolicy();
    const clock = fixedClock(new Date("2026-10-11T12:00:00.000Z"));
    const budget = new ActionBudget(policy, new EventLog(new InMemoryEventStore(), clock), new ActionCounts(), clock);
    return createDeliveryRules(policy, budget, [
      { id: "blog", name: null, description: null, repo: "acme/blog", baseBranch: "develop", setupCommand: null, verifyCommands: ["make test"], protectedPaths: ["infra/"] },
      ...projectsFromPolicy(policy),
    ]);
  };

  it("answers for each project's repository with its own rules, and refuses one that belongs to none", () => {
    expect(rules().repo("acme/blog")).toMatchObject({ ok: true, value: { baseBranch: "develop", verifyCommands: ["make test"] } });
    expect(rules().repo("acme/widgets")).toMatchObject({ ok: true, value: { baseBranch: "main" } });
    expect(rules().repo("acme/other")).toMatchObject({ ok: false, error: expect.stringContaining("belongs to no project") });
  });

  it("installs into the worker's own folder even when it has no package.json yet and a folder above it has one", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "skynot-install-"));
    try {
      await writeFile(path.join(root, "package.json"), '{"name":"the-office"}\n');
      await mkdir(path.join(root, "library"));
      await writeFile(path.join(root, "library", "package.json"), '{"name":"library","version":"1.0.0"}\n');
      const worktree = path.join(root, "workspaces", "listo");
      await mkdir(worktree, { recursive: true });
      const { installCommand } = (rules().repo("acme/blog") as { value: { installCommand: string } }).value;

      await run(exec, "sh", ["-c", `${installCommand} ${path.join(root, "library")}`], { cwd: worktree });

      expect(JSON.parse(await readFile(path.join(worktree, "package.json"), "utf8")).dependencies).toHaveProperty("library");
      expect(await readFile(path.join(root, "package.json"), "utf8")).toBe('{"name":"the-office"}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
