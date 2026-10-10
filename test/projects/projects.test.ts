import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileBriefingStore, YamlProjectCatalog, parseProjectFile } from "../../src/projects";

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(tmpdir(), "skynot-projects-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

const projectYaml = (repo = "acme/widgets") => `version: 1
repo: ${repo}
base_branch: main
setup_command: npm ci
verify_commands: ["npm test"]
protected_paths: [".github/"]
`;

async function addProject(id: string, yaml: string | null = projectYaml(), briefing?: string) {
  await mkdir(path.join(dir, id), { recursive: true });
  if (yaml !== null) await writeFile(path.join(dir, id, "project.yaml"), yaml);
  if (briefing !== undefined) await writeFile(path.join(dir, id, "briefing.md"), briefing);
}

describe("project catalog", () => {
  it("lists one project per folder, in name order, with the folder name as its id", async () => {
    await addProject("zeta", projectYaml("acme/zeta"));
    await addProject("alpha", projectYaml("acme/alpha"));

    const projects = await new YamlProjectCatalog(dir).list();

    expect(projects.map((project) => [project.id, project.repo])).toEqual([["alpha", "acme/alpha"], ["zeta", "acme/zeta"]]);
    expect(projects[0]).toEqual({ id: "alpha", repo: "acme/alpha", baseBranch: "main", setupCommand: "npm ci", verifyCommands: ["npm test"], protectedPaths: [".github/"] });
  });

  it("lists nothing when the folder does not exist", async () => {
    expect(await new YamlProjectCatalog(path.join(dir, "missing")).list()).toEqual([]);
  });

  it("names the folder that is wrong instead of skipping it", async () => {
    await addProject("Bad Name");
    await expect(new YamlProjectCatalog(dir).list()).rejects.toThrow("Bad Name");
  });

  it("refuses a folder without project.yaml, an unknown field and the placeholder repository", async () => {
    await addProject("empty", null);
    await expect(new YamlProjectCatalog(dir).list()).rejects.toThrow("empty has no project.yaml");
    await rm(path.join(dir, "empty"), { recursive: true });

    expect(parseProjectFile("typo", `${projectYaml()}verfy_commands: []\n`)).toMatchObject({ ok: false, error: expect.stringContaining("typo") });
    expect(parseProjectFile("fresh", projectYaml("OWNER/REPO"))).toMatchObject({ ok: false, error: expect.stringContaining("placeholder") });
  });
});

describe("a project's board", () => {
  it("is optional, and names the Status options the usual way unless the file says otherwise", () => {
    expect(parseProjectFile("plain", projectYaml())).toMatchObject({ ok: true, value: { id: "plain" } });
    expect((parseProjectFile("plain", projectYaml()) as { value: { board?: unknown } }).value.board).toBeUndefined();

    const usual = parseProjectFile("blog", `${projectYaml()}board: { owner: rodacato, number: 13 }\n`);
    const custom = parseProjectFile("blog", `${projectYaml()}board: { owner: rodacato, number: 13, columns: { in_review: "Reviewing" } }\n`);

    expect(usual).toMatchObject({ ok: true, value: { board: { owner: "rodacato", number: 13, columns: { proposed: "Todo", in_progress: "In Progress", in_review: "In Progress", done: "Done" } } } });
    expect(custom).toMatchObject({ ok: true, value: { board: { columns: { in_review: "Reviewing", done: "Done" } } } });
    expect(parseProjectFile("blog", `${projectYaml()}board: { owner: rodacato }\n`).ok).toBe(false);
  });
});

describe("briefing store", () => {
  it("reads the briefing of a project, and nothing when there is none or it is empty", async () => {
    await addProject("alpha", projectYaml(), "  The client hates modals.\n");
    await addProject("beta", projectYaml(), "   \n");
    await addProject("gamma");
    const store = new FileBriefingStore(dir, 1000);

    expect(await store.read("alpha")).toBe("The client hates modals.");
    expect(await store.read("beta")).toBeNull();
    expect(await store.read("gamma")).toBeNull();
    expect(await store.read("nobody")).toBeNull();
  });

  it("cuts a long briefing and says so, so the prompt stays bounded", async () => {
    await addProject("alpha", projectYaml(), "x".repeat(50));

    const text = await new FileBriefingStore(dir, 10).read("alpha");

    expect(text).toBe(`${"x".repeat(10)}\n[briefing cut at 10 characters]`);
  });
});
