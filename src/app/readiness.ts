import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineName, RoleEngine } from "../execution";
import type { Exec } from "../kernel/process";
import type { Project } from "../projects";
import type { Team } from "../team";

export interface Finding {
  readonly check: string;
  readonly level: "ok" | "warn" | "fail";
  readonly detail: string;
  readonly fix?: string;
}

export interface ReadinessInput {
  exec: Exec;
  engines: Partial<Record<EngineName, Pick<RoleEngine, "loginStatus">>>;
  usage: EngineUsage;
  repo: string;
  baseBranch: string;
  dataDir: string;
}

export type EngineUsage = Partial<Record<EngineName, { roles: string[]; writes: boolean }>>;

// Which engines the team needs, and whether any role using one writes code (the sandbox must then work).
export function engineUsage(team: Team): EngineUsage {
  const usage: EngineUsage = {};
  const add = (role: string, engine: EngineName, writes: boolean) => {
    const entry = (usage[engine] ??= { roles: [], writes: false });
    entry.roles.push(role);
    entry.writes ||= writes;
  };
  const { manager, developer, code_reviewer: reviewer } = team.roles;
  add("manager", manager.engine, false);
  add("developer", developer.engine, true);
  if (reviewer) add("code_reviewer", reviewer.engine, false);
  for (const [name, worker] of Object.entries(team.workers ?? {})) add(name, worker.engine, true);
  for (const [name, advisor] of Object.entries(team.advisors)) add(name, advisor.engine, false);
  return usage;
}

export interface ShopReadinessInput {
  exec: Exec;
  execFor?: (account: string) => Exec;
  engines: ReadinessInput["engines"];
  teams: ReadonlyArray<{ project: Project; team: Team }>;
  dataDir: string;
}

// The tools and logins are the shop's, checked once; the repository and the token are each project's, asked as the account that owns it.
export async function checkShopReadiness({ exec, execFor, engines, teams, dataDir }: ShopReadinessInput): Promise<Finding[]> {
  const usage: EngineUsage = {};
  for (const { team } of teams) {
    for (const [engine, entry] of Object.entries(engineUsage(team)) as Array<[EngineName, { roles: string[]; writes: boolean }]>) {
      const merged = (usage[engine] ??= { roles: [], writes: false });
      merged.roles.push(...entry.roles.filter((role) => !merged.roles.includes(role)));
      merged.writes ||= entry.writes;
    }
  }
  const shared = await Promise.all([checkNode(), checkGit(exec), checkDataDir(dataDir), ...checkEngines({ engines, usage, exec })]);
  const perProject = await Promise.all(
    teams.map(async ({ project }) => {
      const found = await checkGithub(execFor?.(ownerOf(project.repo)) ?? exec, project.repo, project.baseBranch);
      return teams.length > 1 ? found.map((finding) => ({ ...finding, check: `${project.id}: ${finding.check}` })) : found;
    }),
  );
  return [...shared.flat(), ...perProject.flat()];
}

const ownerOf = (repo: string): string => repo.split("/")[0]!;

const ok = (check: string, detail: string): Finding => ({ check, level: "ok", detail });
const fail = (check: string, detail: string, fix: string): Finding => ({ check, level: "fail", detail, fix });
const warn = (check: string, detail: string, fix: string): Finding => ({ check, level: "warn", detail, fix });

export async function checkReadiness(input: ReadinessInput): Promise<Finding[]> {
  const found = await Promise.all([checkNode(), checkGit(input.exec), checkDataDir(input.dataDir), ...checkEngines(input), checkGithub(input.exec, input.repo, input.baseBranch)]);
  return found.flat();
}

function checkNode(): Finding[] {
  const major = Number(process.versions.node.split(".")[0]);
  return [major >= 22 ? ok("node", `Node ${process.versions.node}`) : fail("node", `Node ${process.versions.node}`, "Node 22 or later is required")];
}

async function checkGit(exec: Exec): Promise<Finding[]> {
  const result = await exec("git", ["--version"]).catch(() => null);
  return [result?.code === 0 ? ok("git", result.stdout.trim()) : fail("git", "git did not answer", "install git")];
}

async function checkDataDir(dataDir: string): Promise<Finding[]> {
  try {
    await mkdir(dataDir, { recursive: true });
    const probe = join(dataDir, ".write-check");
    await writeFile(probe, "ok");
    await rm(probe);
    return [ok("data directory", `${dataDir} is writable`)];
  } catch (error) {
    return [fail("data directory", `${dataDir} is not writable: ${(error as Error).message}`, "fix its permissions or set SKYNOT_DATA")];
  }
}

function checkEngines({ engines, usage, exec }: Pick<ReadinessInput, "engines" | "usage" | "exec">): Array<Promise<Finding[]>> {
  return (Object.entries(usage) as Array<[EngineName, { roles: string[]; writes: boolean }]>).map(async ([name, { roles, writes }]) => {
    const engine = engines[name];
    const login = engine ? await engine.loginStatus() : { loggedIn: false, detail: `no ${name} engine is configured` };
    const findings = [login.loggedIn ? ok(`${name} login`, `used by ${roles.join(", ")}`) : fail(`${name} login`, login.detail, name === "claude" ? "run `claude auth login`" : "run `codex login`")];
    if (name === "codex" && login.loggedIn) findings.push(await codexSandbox(exec, writes, roles));
    return findings;
  });
}

// `codex sandbox` runs a command inside the same sandbox `codex exec` uses, without spending any quota.
async function codexSandbox(exec: Exec, writes: boolean, roles: string[]): Promise<Finding> {
  const result = await exec("codex", ["sandbox", "--", "true"], { timeoutMs: 20_000 }).catch(() => null);
  if (result?.code === 0) return ok("codex sandbox", "commands run inside it");

  const cause = (result?.stderr ?? "").includes("namespace") ? "the container does not allow user namespaces" : "it could not start";
  const fix =
    "start the devcontainer with `--security-opt seccomp=unconfined` (runArgs, or security_opt in docker-compose.yml) and rebuild; or run the shop outside a container";
  return writes
    ? fail("codex sandbox", `${cause}; ${roles.join(", ")} would fail on every run`, fix)
    : warn("codex sandbox", `${cause}: codex can only read what the prompt contains, so the reviewer sees the diff but cannot read the repository or run tests`, fix);
}

async function checkGithub(exec: Exec, repo: string, baseBranch: string): Promise<Finding[]> {
  const auth = await exec("gh", ["auth", "status"]).catch((error: Error) => error);
  if (auth instanceof Error) return [fail("github login", auth.message, `install the GitHub App in the account that owns ${repo}, or log in with \`gh auth login\``)];
  if (auth.code !== 0) return [fail("github login", "gh is not logged in", "log in with `gh auth login` (see .devcontainer/README.md)")];

  const api = (path: string, ...jq: string[]) => exec("gh", ["api", path, ...jq]).catch(() => ({ code: 1, stdout: "", stderr: "gh did not answer" }));
  const reach = (check: string, path: string, fix: string, level: "fail" | "warn" = "fail") =>
    api(path, "--jq", "length").then(({ code, stderr }) => (code === 0 ? ok(check, `${repo}`) : (level === "fail" ? fail : warn)(check, firstLine(stderr), fix)));

  const repoInfo = await api(`repos/${repo}`, "--jq", ".full_name");
  if (repoInfo.code !== 0) return [fail("github repository", `${repo}: ${firstLine(repoInfo.stderr)}`, "give the token access to this repository, or fix `repos[].name` in policy.yaml")];

  const branch = await api(`repos/${repo}/branches/${baseBranch}`, "--jq", ".protected");
  const findings: Finding[] = [ok("github repository", `${repo} is reachable`)];
  findings.push(
    branch.code !== 0
      ? fail("base branch", `${baseBranch} not found in ${repo}`, "fix `base_branch` in policy.yaml")
      : branch.stdout.trim() === "true"
        ? ok("branch protection", `${baseBranch} is protected`)
        : warn("branch protection", `${baseBranch} accepts direct pushes`, "enable a branch protection rule that requires pull requests (the shop only opens PRs, but nothing stops a mistake)"),
  );

  findings.push(
    await reach("pull requests: read", `repos/${repo}/pulls?per_page=1`, "grant the token Pull requests: read and write"),
    await reach("issues: read", `repos/${repo}/issues?per_page=1`, "grant the token Issues: read and write"),
  );

  const sha = await api(`repos/${repo}/commits/${baseBranch}`, "--jq", ".sha");
  findings.push(
    sha.code !== 0
      ? warn("ci status", "could not read the latest commit", "grant the token Contents: read")
      : await api(`repos/${repo}/actions/runs?head_sha=${sha.stdout.trim()}`, "--jq", ".total_count").then(({ code, stderr }) =>
          code === 0
            ? ok("ci status", "GitHub Actions runs are readable")
            : warn("ci status", firstLine(stderr), "grant the token Actions: read, or the card never shows CI and \"Ready to merge\" ignores a red build"),
        ),
  );
  findings.push(await checkPush(exec, repo));
  return findings;
}

// A dry-run push authenticates against receive-pack, so it proves write access without changing anything.
async function checkPush(exec: Exec, repo: string): Promise<Finding> {
  const dir = await mkdtemp(join(tmpdir(), "skynot-readiness-"));
  try {
    const git = (args: string[]) => exec("git", args, { cwd: dir, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 30_000 });
    await git(["init", "-q"]);
    await git(["-c", "user.name=readiness", "-c", "user.email=readiness@invalid", "commit", "-q", "--allow-empty", "-m", "probe"]);
    const push = await git(["push", "--dry-run", `https://github.com/${repo}.git`, "HEAD:refs/heads/skynot-readiness-probe"]);
    return push.code === 0
      ? ok("push access", "the token can push to a branch (dry run, nothing was pushed)")
      : fail("push access", firstLine(push.stderr), "grant the token Contents: read and write, and run `gh auth setup-git`");
  } catch (error) {
    return fail("push access", (error as Error).message, "check that git can reach github.com");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const firstLine = (text: string): string => text.trim().split("\n")[0]?.slice(0, 200) || "no detail";
