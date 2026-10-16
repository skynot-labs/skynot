import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exec, run, type Exec } from "../../kernel/process";
import type { ChecksState, IssueRef, NewPullRequest, PullRequestState, Ticket, Vcs } from "../domain";

const IDENTITY = {
  GIT_AUTHOR_NAME: "skynot office",
  GIT_AUTHOR_EMAIL: "office@skynot.local",
  GIT_COMMITTER_NAME: "skynot office",
  GIT_COMMITTER_EMAIL: "office@skynot.local",
};

interface LocalPullRequest extends NewPullRequest {
  number: number;
  state: "open" | "merged";
  comments: string[];
}

interface Ledger {
  next: number;
  pullRequests: LocalPullRequest[];
}

export type LocalMerge = "merged" | "conflicts" | "not_open";

// GitHub's part for a project on this machine: a bare repository, and the pull requests in a file next to it.
export class LocalRepos implements Vcs {
  private readonly root: string;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    root: string,
    private readonly execute: Exec = exec,
  ) {
    this.root = resolve(root);
  }

  origin(repo: string): string {
    return join(this.root, `${repo}.git`);
  }

  async exists(repo: string): Promise<boolean> {
    return access(this.origin(repo)).then(
      () => true,
      () => false,
    );
  }

  // `files` sit at the root of the first commit, named without folders; a repository already started is left as it is.
  async ensure(repo: string, baseBranch: string, files: Readonly<Record<string, string>> = {}): Promise<void> {
    const origin = this.origin(repo);
    const started = await this.git(origin, "rev-parse", "--verify", `refs/heads/${baseBranch}`).then(
      () => true,
      () => false,
    );
    if (started) return;
    await mkdir(origin, { recursive: true });
    await this.git(origin, "init", "--quiet", "--bare", "--initial-branch", baseBranch);
    const entries: string[] = [];
    for (const [name, content] of Object.entries(files)) {
      const blob = (await run(this.execute, "git", ["hash-object", "-w", "--stdin"], { cwd: origin, input: content })).trim();
      entries.push(`100644 blob ${blob}\t${name}\n`);
    }
    const tree = (await run(this.execute, "git", ["mktree"], { cwd: origin, input: entries.join("") })).trim();
    const names = Object.keys(files);
    const first = (await this.git(origin, "commit-tree", tree, "-m", names.length ? `Start the project with ${names.join(", ")}` : "Start the project")).trim();
    await this.git(origin, "update-ref", `refs/heads/${baseBranch}`, first);
  }

  async createIssue(repo: string): Promise<IssueRef> {
    return this.change(repo, (ledger) => ({ number: ledger.next++, url: "" }));
  }

  async openPullRequest(repo: string, pullRequest: NewPullRequest): Promise<IssueRef> {
    return this.change(repo, (ledger) => {
      const number = ledger.next++;
      ledger.pullRequests.push({ ...pullRequest, number, state: "open", comments: [] });
      return { number, url: "" };
    });
  }

  async pullRequestState(repo: string, number: number): Promise<PullRequestState> {
    const found = await this.pullRequest(repo, number);
    if (found.state === "merged") return "merged";
    const mergedByHand = await this.execute("git", ["merge-base", "--is-ancestor", `refs/heads/${found.head}`, `refs/heads/${found.base}`], { cwd: this.origin(repo) });
    return mergedByHand.code === 0 ? "merged" : "open";
  }

  async pullRequestConflicts(repo: string, number: number): Promise<boolean> {
    const found = await this.pullRequest(repo, number);
    if (found.state === "merged") return false;
    return (await this.mergedTree(repo, found)) === null;
  }

  // True when the branch already holds the current tip of the base, so what was verified is what a merge leaves.
  async builtOnBase(repo: string, number: number): Promise<boolean> {
    const found = await this.pullRequest(repo, number);
    const contains = await this.execute("git", ["merge-base", "--is-ancestor", `refs/heads/${found.base}`, `refs/heads/${found.head}`], { cwd: this.origin(repo) });
    return contains.code === 0;
  }

  async pullRequestDiff(repo: string, number: number): Promise<string> {
    const found = await this.pullRequest(repo, number);
    return this.git(this.origin(repo), "diff", `refs/heads/${found.base}...refs/heads/${found.head}`);
  }

  async pullRequestChecks(): Promise<ChecksState> {
    return "none";
  }

  async commentOnPullRequest(repo: string, number: number, text: string): Promise<void> {
    await this.change(repo, (ledger) => void this.find(ledger, repo, number).comments.push(text));
  }

  async listTickets(): Promise<Ticket[]> {
    return [];
  }

  async addLabel(): Promise<void> {}

  // A squash onto the base branch, as the director's merge on GitHub would leave it.
  merge(repo: string, number: number): Promise<LocalMerge> {
    return this.exclusive(repo, async () => {
      const ledger = await this.read(repo);
      const found = this.find(ledger, repo, number);
      if (found.state !== "open") return "not_open";
      const tree = await this.mergedTree(repo, found);
      if (tree === null) return "conflicts";
      const origin = this.origin(repo);
      const base = (await this.git(origin, "rev-parse", `refs/heads/${found.base}`)).trim();
      const squashed = (await this.git(origin, "commit-tree", tree, "-p", base, "-m", `${found.title} (#${number})`)).trim();
      await this.git(origin, "update-ref", `refs/heads/${found.base}`, squashed, base);
      found.state = "merged";
      await this.write(repo, ledger);
      return "merged";
    });
  }

  private async mergedTree(repo: string, pullRequest: LocalPullRequest): Promise<string | null> {
    const result = await this.execute("git", ["merge-tree", "--write-tree", `refs/heads/${pullRequest.base}`, `refs/heads/${pullRequest.head}`], { cwd: this.origin(repo), env: this.gitEnv() });
    if (result.code === 1) return null;
    if (result.code !== 0) throw new Error(`git merge-tree failed: ${(result.stderr || result.stdout).trim()}`);
    return result.stdout.split("\n")[0]!.trim();
  }

  private async pullRequest(repo: string, number: number): Promise<LocalPullRequest> {
    return this.find(await this.read(repo), repo, number);
  }

  private find(ledger: Ledger, repo: string, number: number): LocalPullRequest {
    const found = ledger.pullRequests.find((candidate) => candidate.number === number);
    if (!found) throw new Error(`no pull request #${number} in ${repo}`);
    return found;
  }

  private change<T>(repo: string, apply: (ledger: Ledger) => T): Promise<T> {
    return this.exclusive(repo, async () => {
      const ledger = await this.read(repo);
      const result = apply(ledger);
      await this.write(repo, ledger);
      return result;
    });
  }

  private async read(repo: string): Promise<Ledger> {
    const source = await readFile(this.ledgerPath(repo), "utf8").catch(() => null);
    return source === null ? { next: 1, pullRequests: [] } : (JSON.parse(source) as Ledger);
  }

  private async write(repo: string, ledger: Ledger): Promise<void> {
    await writeFile(this.ledgerPath(repo), `${JSON.stringify(ledger, null, 2)}\n`);
  }

  private ledgerPath(repo: string): string {
    return join(this.root, `${repo}.json`);
  }

  private exclusive<T>(repo: string, task: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(repo) ?? Promise.resolve()).then(task);
    this.queues.set(repo, result.catch(() => undefined));
    return result;
  }

  private gitEnv(): NodeJS.ProcessEnv {
    return { ...process.env, ...IDENTITY };
  }

  private git(dir: string, ...args: string[]): Promise<string> {
    return run(this.execute, "git", args, { cwd: dir, env: this.gitEnv() });
  }
}
