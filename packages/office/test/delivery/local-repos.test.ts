import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitWorkspace, LocalRepos } from "../../src/delivery";
import { addFiles, git } from "./git-fixture";

let root: string;
let repos: LocalRepos;
let workspace: GitWorkspace;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "skynot-local-"));
  repos = new LocalRepos(path.join(root, "origins"));
  await repos.ensure("listo", "main");
  workspace = new GitWorkspace({ root: path.join(root, "workspaces"), localOrigin: (repo) => repos.origin(repo) });
});

afterEach(() => rm(root, { recursive: true, force: true }));

async function pushWork(branch: string, files: Record<string, string>): Promise<void> {
  const dir = await workspace.prepare("listo", "main", branch);
  await addFiles(dir, files);
  await workspace.commit(dir, `${branch}: work`);
  await workspace.push(dir, branch);
  await workspace.drop("listo", dir);
}

const baseFile = (name: string) => git(repos.origin("listo"), "show", `main:${name}`);

describe("a repository kept on this machine", () => {
  it("starts with one empty commit on the base branch, and starting it again changes nothing", async () => {
    const first = await git(repos.origin("listo"), "rev-list", "main");
    await repos.ensure("listo", "main");

    expect(first.trim().split("\n")).toHaveLength(1);
    expect(await git(repos.origin("listo"), "rev-list", "main")).toBe(first);
    expect((await git(repos.origin("listo"), "ls-tree", "main")).trim()).toBe("");
  });

  it("numbers issues and pull requests in one sequence, as GitHub does, with no address to link", async () => {
    const issue = await repos.createIssue("listo");
    const pull = await repos.openPullRequest("listo", { head: "taller/wo-0001", base: "main", title: "WO-0001: Add todos", body: "Closes #1" });

    expect(issue).toEqual({ number: 1, url: "" });
    expect(pull).toEqual({ number: 2, url: "" });
  });

  it("shows the branch against the base as the pull request's diff", async () => {
    await pushWork("taller/wo-0001", { "src/todo.ts": "export const todo = 1;\n" });
    const pull = await repos.openPullRequest("listo", { head: "taller/wo-0001", base: "main", title: "WO-0001: Add todos", body: "" });

    const diff = await repos.pullRequestDiff("listo", pull.number);

    expect(diff).toContain("+++ b/src/todo.ts");
    expect(diff).toContain("+export const todo = 1;");
  });

  it("merges by squashing the branch onto the base, so the base keeps a straight line", async () => {
    await pushWork("taller/wo-0001", { "src/todo.ts": "export const todo = 1;\n" });
    const pull = await repos.openPullRequest("listo", { head: "taller/wo-0001", base: "main", title: "WO-0001: Add todos", body: "" });

    expect(await repos.pullRequestState("listo", pull.number)).toBe("open");
    expect(await repos.merge("listo", pull.number)).toBe("merged");

    expect(await baseFile("src/todo.ts")).toBe("export const todo = 1;\n");
    expect((await git(repos.origin("listo"), "log", "--format=%s", "main")).trim().split("\n")).toEqual(["WO-0001: Add todos (#1)", "Start the project"]);
    expect(await repos.pullRequestState("listo", pull.number)).toBe("merged");
    expect(await repos.merge("listo", pull.number)).toBe("not_open");
  });

  it("refuses a merge that conflicts with the base and leaves the base as it was", async () => {
    await pushWork("taller/wo-0001", { "src/todo.ts": "one\n" });
    await pushWork("taller/wo-0002", { "src/todo.ts": "two\n" });
    const first = await repos.openPullRequest("listo", { head: "taller/wo-0001", base: "main", title: "First", body: "" });
    const second = await repos.openPullRequest("listo", { head: "taller/wo-0002", base: "main", title: "Second", body: "" });
    await repos.merge("listo", first.number);
    const base = await git(repos.origin("listo"), "rev-parse", "main");

    expect(await repos.pullRequestConflicts("listo", second.number)).toBe(true);
    expect(await repos.merge("listo", second.number)).toBe("conflicts");
    expect(await git(repos.origin("listo"), "rev-parse", "main")).toBe(base);
    expect(await repos.pullRequestState("listo", second.number)).toBe("open");
    expect(await baseFile("src/todo.ts")).toBe("one\n");
  });

  it("sees a branch the director merged by hand with git as merged", async () => {
    await pushWork("taller/wo-0001", { "src/todo.ts": "one\n" });
    const pull = await repos.openPullRequest("listo", { head: "taller/wo-0001", base: "main", title: "First", body: "" });
    await git(repos.origin("listo"), "update-ref", "refs/heads/main", "refs/heads/taller/wo-0001");

    expect(await repos.pullRequestState("listo", pull.number)).toBe("merged");
  });

  it("keeps its pull requests across a restart of the office", async () => {
    await repos.openPullRequest("listo", { head: "taller/wo-0001", base: "main", title: "First", body: "" });
    await repos.commentOnPullRequest("listo", 1, "Looks right");

    const reopened = new LocalRepos(path.join(root, "origins"));
    const ledger = JSON.parse(await readFile(path.join(root, "origins", "listo.json"), "utf8"));

    expect(await reopened.pullRequestChecks()).toBe("none");
    expect(await reopened.openPullRequest("listo", { head: "taller/wo-0002", base: "main", title: "Second", body: "" })).toEqual({ number: 2, url: "" });
    expect(ledger.pullRequests[0].comments).toEqual(["Looks right"]);
  });
});
