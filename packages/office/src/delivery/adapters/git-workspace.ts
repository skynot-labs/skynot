import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { TIMED_OUT, exec, run, type Exec } from "../../kernel/process";
import type { CommandOutcome, FileChange, Workspace } from "../domain";

const IDENTITY = {
  GIT_AUTHOR_NAME: "skynot worker",
  GIT_AUTHOR_EMAIL: "worker@skynot.local",
  GIT_COMMITTER_NAME: "skynot worker",
  GIT_COMMITTER_EMAIL: "worker@skynot.local",
};

export interface GitWorkspaceOptions {
  root: string;
  execute?: Exec;
  clone?: (repo: string, dir: string) => Promise<void>;
  // The path of a repository kept on this machine, cloned with git instead of from GitHub.
  localOrigin?: (repo: string) => string | undefined;
}

export class GitWorkspace implements Workspace {
  private readonly execute: Exec;
  private readonly cloneRepo: (repo: string, dir: string) => Promise<void>;
  private readonly queues = new Map<string, Promise<unknown>>();

  private readonly options: GitWorkspaceOptions;

  constructor(options: GitWorkspaceOptions) {
    // git resolves relative paths against its own cwd, not ours
    this.options = { ...options, root: resolve(options.root) };
    this.execute = options.execute ?? exec;
    this.cloneRepo =
      options.clone ??
      (async (repo, dir) => {
        const origin = options.localOrigin?.(repo);
        await (origin ? run(this.execute, "git", ["clone", "--quiet", origin, dir]) : run(this.execute, "gh", ["repo", "clone", repo, dir, "--", "--quiet"]));
      });
  }

  readingCopy(repo: string, baseBranch: string): Promise<string> {
    return this.exclusive(repo, () => this.refresh(repo, baseBranch));
  }

  prepare(repo: string, baseBranch: string, branch: string): Promise<string> {
    return this.exclusive(repo, () => this.cutWorktree(repo, baseBranch, branch));
  }

  // A squash leaves conflicts as markers in the files, with no rebase or merge state to finish.
  prepareFollowUp(repo: string, baseBranch: string, branch: string): Promise<string> {
    return this.exclusive(repo, async () => {
      const dir = await this.cutWorktree(repo, baseBranch, branch);
      const merged = await this.execute("git", ["merge", "--squash", `origin/${branch}`], { cwd: dir, env: this.gitEnv() });
      const conflicts = (await this.git(dir, "diff", "--name-only", "--diff-filter=U")).trim();
      if (merged.code !== 0 && !conflicts) throw new Error(`could not bring ${branch} up to date: ${(merged.stderr || merged.stdout).trim()}`);
      return dir;
    });
  }

  async changes(dir: string): Promise<FileChange[]> {
    // -z leaves paths unquoted: without it git wraps names with spaces or accents in quotes, and a protected path stops matching
    const entries = (await this.git(dir, "status", "--porcelain", "-z", "--untracked-files=all")).split("\0").filter(Boolean);
    const changes: FileChange[] = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      const status = entry.slice(0, 2).trim();
      changes.push({ status, path: entry.slice(3) });
      // a rename or copy is followed by the path it came from
      if (/[RC]/.test(entry.slice(0, 2))) changes.push({ status: "R", path: entries[++index] ?? "" });
    }
    return changes;
  }

  async commit(dir: string, message: string): Promise<void> {
    await this.git(dir, "add", "-A");
    await this.git(dir, "commit", "-m", message);
  }

  async push(dir: string, branch: string): Promise<void> {
    await this.git(dir, "push", "--force-with-lease", "-u", "origin", `${branch}:${branch}`);
  }

  drop(repo: string, dir: string): Promise<void> {
    return this.exclusive(repo, async () => {
      await this.git(this.readingCopyPath(repo), "worktree", "remove", "--force", dir).catch(() => rm(dir, { recursive: true, force: true }));
    });
  }

  async run(dir: string, command: string, timeoutMs: number, signal?: AbortSignal): Promise<CommandOutcome> {
    const result = await this.execute("sh", ["-c", command], { cwd: dir, timeoutMs, ...(signal && { signal }) });
    const output = `${result.stdout}${result.stderr}`.trim();
    return { ok: result.code === 0, output: result.code === TIMED_OUT ? `timed out: ${output}` : output };
  }

  private exclusive<T>(repo: string, task: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(repo) ?? Promise.resolve()).then(task);
    this.queues.set(repo, result.catch(() => undefined));
    return result;
  }

  private readingCopyPath(repo: string): string {
    return join(this.options.root, "repos", repo);
  }

  private async refresh(repo: string, baseBranch: string): Promise<string> {
    const dir = this.readingCopyPath(repo);
    const cloned = await this.git(dir, "rev-parse", "--git-dir").then(
      () => true,
      () => false,
    );
    if (!cloned) {
      await mkdir(dirname(dir), { recursive: true });
      await this.cloneRepo(repo, dir);
    }
    await this.git(dir, "fetch", "--prune", "origin");
    await this.git(dir, "checkout", "--detach", "--force", `origin/${baseBranch}`);
    await this.git(dir, "clean", "-fdx");
    return dir;
  }

  private async cutWorktree(repo: string, baseBranch: string, branch: string): Promise<string> {
    const source = await this.refresh(repo, baseBranch);
    const dir = join(this.options.root, "worktrees", repo, branch.replaceAll("/", "-"));
    await rm(dir, { recursive: true, force: true });
    await this.git(source, "worktree", "prune");
    await this.git(source, "worktree", "add", "-B", branch, dir, `origin/${baseBranch}`);
    return dir;
  }

  private gitEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...IDENTITY };
  }

  private git(dir: string, ...args: string[]): Promise<string> {
    return run(this.execute, "git", args, { cwd: dir, env: this.gitEnv() });
  }
}
