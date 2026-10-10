import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitWorkspace } from "../../src/delivery";
import { addFiles, cloneFrom, createSandbox, git, type Sandbox } from "./git-fixture";

let sandbox: Sandbox;
let workspace: GitWorkspace;

beforeEach(async () => {
  sandbox = await createSandbox();
  workspace = new GitWorkspace({ root: path.join(sandbox.root, "shop"), clone: cloneFrom(sandbox.origin) });
});

afterEach(() => sandbox.cleanup());

describe("git workspace", () => {
  it("cuts a worktree for the branch from the tip of the base branch", async () => {
    const dir = await workspace.prepare("acme/widgets", "main", "taller/wo-0001");

    expect((await git(dir, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("taller/wo-0001");
    expect(await readFile(path.join(dir, "src/app.txt"), "utf8")).toBe("app\n");
  });

  it("gives a reading copy at the tip of the base branch, refreshed on every call", async () => {
    const first = await workspace.readingCopy("acme/widgets", "main");
    expect(await readFile(path.join(first, "src/app.txt"), "utf8")).toBe("app\n");

    const upstream = path.join(sandbox.root, "upstream");
    await git(sandbox.root, "clone", "--quiet", sandbox.origin, upstream);
    await addFiles(upstream, { "src/later.txt": "later\n" });
    await git(upstream, "add", "-A");
    await git(upstream, "commit", "-m", "later");
    await git(upstream, "push", "origin", "main");

    const second = await workspace.readingCopy("acme/widgets", "main");

    expect(second).toBe(first);
    expect(await readFile(path.join(second, "src/later.txt"), "utf8")).toBe("later\n");
  });

  it("reports new, modified and deleted files", async () => {
    const dir = await workspace.prepare("acme/widgets", "main", "taller/wo-0001");
    await addFiles(dir, { "src/new.txt": "new\n" });
    await writeFile(path.join(dir, "src/app.txt"), "changed\n");
    await rm(path.join(dir, "test/app.test.txt"));

    const changes = await workspace.changes(dir);

    expect(changes).toEqual(
      expect.arrayContaining([
        { status: "??", path: "src/new.txt" },
        { status: "M", path: "src/app.txt" },
        { status: "D", path: "test/app.test.txt" },
      ]),
    );
  });

  it("commits and pushes the branch without touching main", async () => {
    const dir = await workspace.prepare("acme/widgets", "main", "taller/wo-0001");
    await addFiles(dir, { "src/feature.txt": "feature\n" });

    await workspace.commit(dir, "WO-0001: Add feature\n\nCloses #7");
    await workspace.push(dir, "taller/wo-0001");

    expect((await git(sandbox.origin, "log", "-1", "--format=%s", "taller/wo-0001")).trim()).toBe("WO-0001: Add feature");
    expect((await git(sandbox.origin, "log", "-1", "--format=%s", "main")).trim()).toBe("initial");
    expect((await git(sandbox.origin, "log", "-1", "--format=%an", "taller/wo-0001")).trim()).toBe("skynot worker");
  });

  it("starts a second run from a clean copy of the latest base branch", async () => {
    const first = await workspace.prepare("acme/widgets", "main", "taller/wo-0001");
    await addFiles(first, { "src/leftover.txt": "leftover\n" });

    const upstream = path.join(sandbox.root, "upstream");
    await git(sandbox.root, "clone", "--quiet", sandbox.origin, upstream);
    await addFiles(upstream, { "src/later.txt": "later\n" });
    await git(upstream, "add", "-A");
    await git(upstream, "commit", "-m", "later");
    await git(upstream, "push", "origin", "main");

    const second = await workspace.prepare("acme/widgets", "main", "taller/wo-0001");

    await expect(stat(path.join(second, "src/leftover.txt"))).rejects.toThrow();
    expect(await readFile(path.join(second, "src/later.txt"), "utf8")).toBe("later\n");
  });

  it("prepares two branches of the same repo at once, each in its own worktree", async () => {
    const [first, second] = await Promise.all([
      workspace.prepare("acme/widgets", "main", "taller/wo-0001"),
      workspace.prepare("acme/widgets", "main", "taller/wo-0002"),
    ]);

    expect(first).not.toBe(second);
    expect((await git(first, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("taller/wo-0001");
    expect((await git(second, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("taller/wo-0002");

    await Promise.all([workspace.drop("acme/widgets", first), workspace.drop("acme/widgets", second)]);
    await expect(stat(first)).rejects.toThrow();
    await expect(stat(second)).rejects.toThrow();
  });

  it("removes the worktree when dropped", async () => {
    const dir = await workspace.prepare("acme/widgets", "main", "taller/wo-0001");

    await workspace.drop("acme/widgets", dir);

    await expect(stat(dir)).rejects.toThrow();
  });

  it("runs commands in the worktree and reports failures with their output", async () => {
    const dir = await workspace.prepare("acme/widgets", "main", "taller/wo-0001");

    expect(await workspace.run(dir, "test -f src/app.txt", 5000)).toEqual({ ok: true, output: "" });
    expect(await workspace.run(dir, "echo broken >&2; exit 3", 5000)).toEqual({ ok: false, output: "broken" });
  });

  it("stops a command that runs too long", async () => {
    const dir = await workspace.prepare("acme/widgets", "main", "taller/wo-0001");

    const outcome = await workspace.run(dir, "sleep 5", 100);

    expect(outcome.ok).toBe(false);
    expect(outcome.output).toContain("timed out");
  });
});
