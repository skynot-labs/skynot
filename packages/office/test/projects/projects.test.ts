import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileBriefingStore, YamlProjectCatalog, YamlProjectRegistry, parseProjectFile, type ProjectFile } from "../../src/projects";

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
    expect(projects[0]).toEqual({ id: "alpha", name: null, description: null, repo: "acme/alpha", baseBranch: "main", setupCommand: "npm ci", verifyCommands: ["npm test"], protectedPaths: [".github/"] });
  });

  it("lists nothing when the folder does not exist", async () => {
    expect(await new YamlProjectCatalog(path.join(dir, "missing")).list()).toEqual([]);
  });

  it("names the folder that is wrong instead of skipping it", async () => {
    await addProject("Bad Name");
    await expect(new YamlProjectCatalog(dir).list()).rejects.toThrow("Bad Name");
  });

  it("leaves alone a folder without project.yaml, and refuses an unknown field and the placeholder repository", async () => {
    await addProject("Some App", null);
    expect(await new YamlProjectCatalog(dir).list()).toEqual([]);

    expect(parseProjectFile("typo", `${projectYaml()}verfy_commands: []\n`)).toMatchObject({ ok: false, error: expect.stringContaining("typo") });
    expect(parseProjectFile("fresh", projectYaml("OWNER/REPO"))).toMatchObject({ ok: false, error: expect.stringContaining("placeholder") });
  });

  it("reads auto_merge for a project kept on this machine, and refuses it for one on GitHub", () => {
    const local = projectYaml().replace("repo: acme/widgets", "local: true");

    expect(parseProjectFile("listo", `${local}auto_merge: {}\n`)).toMatchObject({ ok: true, value: { autoMerge: { never: [] } } });
    expect(parseProjectFile("listo", `${local}auto_merge: { max_changed_lines: 120, never: [docs/legal/] }\n`)).toMatchObject({ ok: true, value: { autoMerge: { maxChangedLines: 120, never: ["docs/legal/"] } } });
    expect(parseProjectFile("listo", local)).toMatchObject({ ok: true, value: expect.not.objectContaining({ autoMerge: expect.anything() }) });
    expect(parseProjectFile("widgets", `${projectYaml()}auto_merge: {}\n`)).toMatchObject({ ok: false, error: expect.stringContaining("auto_merge works only for a project kept on this machine") });
    expect(parseProjectFile("listo", `${local}auto_merge: { max_changed_lines: 0 }\n`)).toMatchObject({ ok: false });
  });

  it("reads a project kept on this machine, whose key is its id, and refuses one that names both a repository and local, or neither", () => {
    const local = projectYaml().replace("repo: acme/widgets", "local: true");

    expect(parseProjectFile("listo", local)).toMatchObject({ ok: true, value: { id: "listo", repo: "listo", local: true } });
    expect(parseProjectFile("widgets", projectYaml())).toMatchObject({ ok: true, value: { repo: "acme/widgets" } });
    expect((parseProjectFile("widgets", projectYaml()) as { value: object }).value).not.toHaveProperty("local");
    expect(parseProjectFile("both", `${projectYaml()}local: true\n`)).toMatchObject({ ok: false, error: expect.stringContaining("local: true") });
    expect(parseProjectFile("neither", projectYaml().replace("repo: acme/widgets\n", ""))).toMatchObject({ ok: false, error: expect.stringContaining("local: true") });
    expect(parseProjectFile("off", projectYaml().replace("repo: acme/widgets", "local: false"))).toMatchObject({ ok: false });
  });
});

describe("a project's name and description", () => {
  it("are optional, and trimmed when given", () => {
    expect(parseProjectFile("plain", projectYaml())).toMatchObject({ ok: true, value: { name: null, description: null } });
    expect(parseProjectFile("blog", `${projectYaml()}name: "  The Blog "\ndescription: "  Where we write.  "\n`)).toMatchObject({ ok: true, value: { name: "The Blog", description: "Where we write." } });
    expect(parseProjectFile("blog", `${projectYaml()}name: ${"n".repeat(60)}\ndescription: ${"d".repeat(280)}\n`).ok).toBe(true);
  });

  it("refuses an empty or over-long name, an over-long description, and still an unknown field", () => {
    expect(parseProjectFile("blog", `${projectYaml()}name: ${"n".repeat(61)}\n`)).toMatchObject({ ok: false, error: expect.stringContaining("at most 60") });
    expect(parseProjectFile("blog", `${projectYaml()}name: "   "\n`)).toMatchObject({ ok: false, error: expect.stringContaining("cannot be empty") });
    expect(parseProjectFile("blog", `${projectYaml()}description: ${"d".repeat(281)}\n`)).toMatchObject({ ok: false, error: expect.stringContaining("at most 280") });
    expect(parseProjectFile("blog", `${projectYaml()}name: Blog\ntitle: Blog\n`)).toMatchObject({ ok: false, error: expect.stringContaining("title") });
  });
});

describe("registering a project", () => {
  const file = (over: Partial<ProjectFile> = {}): ProjectFile => ({ version: 1, repo: "acme/blog", base_branch: "main", setup_command: null, verify_commands: ["npm test"], protected_paths: [".github/"], ...over });

  it("writes a project.yaml the catalog reads back as the project it returned", async () => {
    const folder = path.join(dir, "not-there-yet");
    const full = file({ name: "  The Blog ", description: "Line one\nline: two # not a comment", setup_command: "npm ci", board: { owner: "acme", number: 3, columns: { in_review: "Reviewing" } } });

    const registered = await new YamlProjectRegistry(folder).register("blog", full);
    const plain = await new YamlProjectRegistry(folder).register("docs", file({ repo: "acme/docs" }));

    expect(registered).toMatchObject({ ok: true, value: { id: "blog", name: "The Blog", description: "Line one\nline: two # not a comment", setupCommand: "npm ci", board: { number: 3, columns: { in_review: "Reviewing", done: "Done" } } } });
    expect(plain).toMatchObject({ ok: true, value: { id: "docs", name: null, description: null, setupCommand: null } });
    expect(await new YamlProjectCatalog(folder).list()).toEqual([(registered as { value: unknown }).value, (plain as { value: unknown }).value]);
  });

  it("never writes over a folder that is already there, with or without a project in it", async () => {
    await addProject("blog", projectYaml("acme/original"));
    await addProject("notes", null);
    const registry = new YamlProjectRegistry(dir);

    expect(await registry.register("blog", file())).toMatchObject({ ok: false, error: expect.stringContaining("already exists") });
    expect(await registry.register("notes", file())).toMatchObject({ ok: false, error: expect.stringContaining("already exists") });
    expect(await readFile(path.join(dir, "blog", "project.yaml"), "utf8")).toBe(projectYaml("acme/original"));
    expect(await new YamlProjectCatalog(dir).list()).toMatchObject([{ id: "blog", repo: "acme/original" }]);
  });

  it("refuses an id that cannot be a folder name, and a file the catalog would not read, without leaving a folder behind", async () => {
    const registry = new YamlProjectRegistry(dir);

    for (const id of ["Blog", "b", "../escape", "blog/inner", "1blog"]) expect(await registry.register(id, file())).toMatchObject({ ok: false, error: expect.stringContaining("project id") });
    expect(await registry.register("blog", file({ repo: "not a repository" }))).toMatchObject({ ok: false, error: expect.stringContaining("owner/name") });
    expect(await registry.register("blog", file({ verify_commands: [] }))).toMatchObject({ ok: false, error: expect.stringContaining("verify_commands") });
    expect(await registry.register("blog", file({ name: "n".repeat(61) }))).toMatchObject({ ok: false, error: expect.stringContaining("at most 60") });
    expect(await registry.register("blog", { ...file(), owner: "me" } as ProjectFile)).toMatchObject({ ok: false, error: expect.stringContaining("owner") });
    expect(await registry.register("blog", file({ repo: "OWNER/REPO" }))).toMatchObject({ ok: false, error: expect.stringContaining("placeholder") });
    expect(await new YamlProjectCatalog(dir).list()).toEqual([]);
    expect(await registry.register("blog", file())).toMatchObject({ ok: true });
  });
});

describe("describing a project", () => {
  const commented = `# The blog, since 2019.
version: 1

repo: acme/blog   # moved from the old org
base_branch: main
setup_command: npm ci
verify_commands: [ "npm run typecheck",   "npm test" ]
# Hands off.
protected_paths: [".github/", ".claude/", ".mcp.json", "AGENTS.md", "CLAUDE.md", "vitest.config*", "a-very-long-path/that-goes/past-eighty-columns/"]
board: { owner: acme, number: 3 }
`;
  const read = () => readFile(path.join(dir, "blog", "project.yaml"), "utf8");

  it("adds the two keys and leaves every other byte of the director's file alone", async () => {
    await addProject("blog", commented);

    const described = await new YamlProjectRegistry(dir).describe("blog", { name: " The Blog ", description: "Posts: weekly # really" });

    expect(described).toMatchObject({ ok: true, value: { id: "blog", name: "The Blog", description: "Posts: weekly # really", repo: "acme/blog" } });
    expect(await read()).toBe(commented.replace("version: 1\n", 'version: 1\nname: The Blog\ndescription: "Posts: weekly # really"\n'));
    expect((await new YamlProjectCatalog(dir).list())[0]).toEqual((described as { value: unknown }).value);
  });

  it("changes one field without touching the other, keeping the comment on its line", async () => {
    const before = commented.replace("version: 1\n", 'version: 1\nname: "Old"   # the label\ndescription: >\n  folded\n  text\n');
    await addProject("blog", before);
    const registry = new YamlProjectRegistry(dir);

    expect(await registry.describe("blog", { name: "New" })).toMatchObject({ ok: true, value: { name: "New", description: "folded text" } });
    expect(await read()).toBe(before.replace('name: "Old"', "name: New"));

    expect(await registry.describe("blog", { description: "Two\nlines" })).toMatchObject({ ok: true, value: { name: "New", description: "Two\nlines" } });
    expect(await read()).toBe(commented.replace("version: 1\n", 'version: 1\nname: New   # the label\ndescription: "Two\\nlines"\n'));
  });

  it("removes a field given as null, and leaves the file as it is when nothing is asked", async () => {
    const before = commented.replace("version: 1\n", "version: 1\nname: Blog\n") + "description: Last line, no newline after";
    await addProject("blog", before);
    const registry = new YamlProjectRegistry(dir);

    expect(await registry.describe("blog", {})).toMatchObject({ ok: true, value: { name: "Blog", description: "Last line, no newline after" } });
    expect(await read()).toBe(before);

    expect(await registry.describe("blog", { description: null })).toMatchObject({ ok: true, value: { name: "Blog", description: null } });
    expect(await read()).toBe(commented.replace("version: 1\n", "version: 1\nname: Blog\n"));

    expect(await registry.describe("blog", { name: null, description: null })).toMatchObject({ ok: true, value: { name: null, description: null } });
    expect(await read()).toBe(commented);
  });

  it("refuses a name or description the catalog would not read, and writes nothing", async () => {
    await addProject("blog", commented);
    const registry = new YamlProjectRegistry(dir);

    expect(await registry.describe("blog", { name: "n".repeat(61) })).toMatchObject({ ok: false, error: expect.stringContaining("at most 60") });
    expect(await registry.describe("blog", { name: "  " })).toMatchObject({ ok: false, error: expect.stringContaining("cannot be empty") });
    expect(await registry.describe("blog", { name: "Fine", description: "d".repeat(281) })).toMatchObject({ ok: false, error: expect.stringContaining("at most 280") });
    expect(await read()).toBe(commented);
  });

  it("refuses a project without a folder, saying where it comes from, and a file that is already broken", async () => {
    await addProject("notes", null);
    await addProject("broken", `${projectYaml()}verfy_commands: []\n`);
    const registry = new YamlProjectRegistry(dir);

    expect(await registry.describe("widgets", { name: "Widgets" })).toMatchObject({ ok: false, error: expect.stringContaining("comes from policy.yaml or from the demo") });
    expect(await registry.describe("notes", { name: "Notes" })).toMatchObject({ ok: false, error: expect.stringContaining("cannot be described") });
    expect(await registry.describe("../blog", { name: "Escape" })).toMatchObject({ ok: false });
    expect(await registry.describe("broken", { name: "Broken" })).toMatchObject({ ok: false, error: expect.stringContaining("verfy_commands") });
    expect(await readFile(path.join(dir, "broken", "project.yaml"), "utf8")).toBe(`${projectYaml()}verfy_commands: []\n`);
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
