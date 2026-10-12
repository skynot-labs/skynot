import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkReadiness, checkShopReadiness, engineUsage, type Finding } from "../../src/app/readiness";
import { GithubAppTokens, asGithubApp } from "../../src/delivery";
import type { Exec, ExecResult } from "../../src/kernel/process";
import type { Team } from "../../src/team";

let dataDir: string;
beforeEach(async () => void (dataDir = await mkdtemp(path.join(tmpdir(), "skynot-ready-"))));
afterEach(() => rm(dataDir, { recursive: true, force: true }));

const done = (stdout = "", code = 0, stderr = ""): ExecResult => ({ stdout, stderr, code });

// Scripted answers for the commands outside our control: gh, git and codex.
function world(overrides: Record<string, ExecResult> = {}): Exec {
  const answers: Record<string, ExecResult> = {
    "git --version": done("git version 2.53.0"),
    "gh auth status": done("Logged in"),
    "gh api repos/acme/widgets": done("acme/widgets"),
    "gh api repos/acme/widgets/branches/main": done("true"),
    "gh api repos/acme/widgets/pulls?per_page=1": done("1"),
    "gh api repos/acme/widgets/issues?per_page=1": done("1"),
    "gh api repos/acme/widgets/commits/main": done("abc123"),
    "gh api repos/acme/widgets/actions/runs?head_sha=abc123": done("1"),
    "codex sandbox": done(),
    ...overrides,
  };
  return async (command, args) => {
    const key = [command, ...args].filter((arg) => !["--jq", "length", ".full_name", ".protected", ".sha"].includes(arg)).join(" ");
    const hit = Object.entries(answers).find(([prefix]) => key === prefix || key.startsWith(`${prefix} `));
    if (hit) return hit[1];
    if (command === "git") return done();
    return done("", 1, `no answer scripted for ${key}`);
  };
}

const team = (overrides: Partial<Team["roles"]> = {}): Team => ({
  version: 1,
  roles: { manager: { engine: "claude" }, developer: { engine: "claude" }, code_reviewer: { engine: "codex" }, ...overrides },
  advisors: {},
  library: {},
});

const loggedIn = { loginStatus: async () => ({ loggedIn: true, detail: "ok" }) };

const readiness = (exec: Exec, engines = team(), login = { claude: loggedIn, codex: loggedIn }) =>
  checkReadiness({ exec, engines: login, usage: engineUsage(engines), repo: "acme/widgets", baseBranch: "main", dataDir });

const problems = (findings: Finding[]) => findings.filter((finding) => finding.level !== "ok").map((finding) => `${finding.level} ${finding.check}`);

describe("readiness", () => {
  it("reports nothing wrong when everything the shop needs works", async () => {
    expect(problems(await readiness(world()))).toEqual([]);
  });

  it("says which engines the team needs and whether any of them writes code", () => {
    expect(engineUsage(team())).toEqual({ claude: { roles: ["manager", "developer"], writes: true }, codex: { roles: ["code_reviewer"], writes: false } });
  });

  it("warns about a codex that cannot sandbox when it only reviews, and fails when it writes code", async () => {
    const broken = world({ "codex sandbox": done("", 1, "bwrap: No permissions to create a new namespace") });

    expect(problems(await readiness(broken))).toEqual(["warn codex sandbox"]);
    expect(problems(await readiness(broken, team({ developer: { engine: "codex" } })))).toEqual(["fail codex sandbox"]);
  });

  it("fails for an engine nobody is logged in to, and names the command", async () => {
    const findings = await readiness(world(), team(), { claude: loggedIn, codex: { loginStatus: async () => ({ loggedIn: false, detail: "run `codex login`" }) } });

    expect(findings.find((finding) => finding.level === "fail")).toMatchObject({ check: "codex login", fix: "run `codex login`" });
  });

  it("only warns when the token cannot read CI, because the shop still works without it", async () => {
    const noChecks = world({ "gh api repos/acme/widgets/actions/runs?head_sha=abc123": done("", 1, "gh: Resource not accessible by personal access token (HTTP 403)") });

    const findings = await readiness(noChecks);

    expect(problems(findings)).toEqual(["warn ci status"]);
    expect(findings.find((finding) => finding.check === "ci status")?.fix).toContain("Actions: read");
  });

  it("warns that the base branch accepts direct pushes", async () => {
    expect(problems(await readiness(world({ "gh api repos/acme/widgets/branches/main": done("false") })))).toEqual(["warn branch protection"]);
  });

  it("stops at the login when gh is not logged in, instead of listing a dozen consequences", async () => {
    const findings = await readiness(world({ "gh auth status": done("", 1, "not logged in") }));

    expect(problems(findings)).toEqual(["fail github login"]);
  });

  it("fails when the repository cannot be reached or the push is refused", async () => {
    expect(problems(await readiness(world({ "gh api repos/acme/widgets": done("", 1, "HTTP 404") })))).toEqual(["fail github repository"]);

    const refused: Exec = async (command, args, options) =>
      command === "git" && args.includes("push") ? done("", 128, "remote: Permission denied") : world()(command, args, options);
    expect(problems(await readiness(refused))).toEqual(["fail push access"]);
  });
});

describe("readiness of several projects", () => {
  const project = (id: string, repo: string) => ({ id, name: null, description: null, repo, baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [] });

  it("checks the tools once and the repository of each project, naming the project that has the problem", async () => {
    const exec = world({ "gh api repos/acme/blog": done("", 1, "HTTP 404") });
    const teams = [
      { project: project("widgets", "acme/widgets"), team: team() },
      { project: project("blog", "acme/blog"), team: team() },
    ];

    const findings = await checkShopReadiness({ exec, engines: { claude: loggedIn, codex: loggedIn }, teams, dataDir });

    expect(problems(findings)).toEqual(["fail blog: github repository"]);
    expect(findings.filter((finding) => finding.check === "git")).toHaveLength(1);
    expect(findings.some((finding) => finding.check === "widgets: github repository" && finding.level === "ok")).toBe(true);
  });

  describe("as a GitHub App installed in several accounts", () => {
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const installed = (async (url: string | URL | Request) => {
      const path = String(url).replace("https://api.github.com", "");
      if (path.startsWith("/app/installations?")) return Response.json([{ id: 1, account: { login: "acme" } }, { id: 2, account: { login: "other" } }]);
      return Response.json({ token: path.includes("/1/") ? "token-acme" : "token-other", expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    }) as typeof fetch;

    const site = {
      "gh api repos/other/site": done("other/site"),
      "gh api repos/other/site/branches/main": done("true"),
      "gh api repos/other/site/pulls?per_page=1": done("1"),
      "gh api repos/other/site/issues?per_page=1": done("1"),
      "gh api repos/other/site/commits/main": done("abc123"),
      "gh api repos/other/site/actions/runs?head_sha=abc123": done("1"),
    };

    function shop() {
      const ran: string[] = [];
      const answer = world(site);
      const recorded: Exec = (command, args, options) => {
        const as = options?.env?.GH_TOKEN?.replace("token-", "") ?? "nobody";
        ran.push(`${as}: ${command} ${args.filter((arg) => !arg.startsWith("user.") && arg !== "-c" && arg !== "-q").join(" ")}`);
        return answer(command, args, options);
      };
      const tokens = new GithubAppTokens({ appId: "42", privateKey, fetch: installed });
      return { ran, exec: asGithubApp(recorded, tokens), execFor: (account: string) => asGithubApp(recorded, tokens, account) };
    }

    const check = ({ exec, execFor }: ReturnType<typeof shop>, repos: Record<string, string>) =>
      checkShopReadiness({
        exec,
        execFor,
        engines: { claude: loggedIn, codex: loggedIn },
        teams: Object.entries(repos).map(([id, repo]) => ({ project: project(id, repo), team: team() })),
        dataDir,
      });

    it("checks each project as the account that owns its repository, and git itself as nobody", async () => {
      const app = shop();

      const findings = await check(app, { widgets: "acme/widgets", site: "other/site" });

      expect(problems(findings)).toEqual([]);
      expect(app.ran).toContain("nobody: git --version");
      for (const probe of ["gh auth status", "git init", "git commit --allow-empty -m probe"]) {
        expect(app.ran.filter((line) => line.endsWith(`: ${probe}`)).sort()).toEqual([`acme: ${probe}`, `other: ${probe}`]);
      }
      expect(app.ran.filter((line) => line.includes("repos/other/") && !line.startsWith("other: "))).toEqual([]);
      expect(app.ran.filter((line) => line.includes("repos/acme/") && !line.startsWith("acme: "))).toEqual([]);
    });

    it("names the account the app is missing from, and still checks the other projects", async () => {
      const findings = await check(shop(), { widgets: "acme/widgets", todo: "stranger/todo" });

      expect(problems(findings)).toEqual(["fail todo: github login"]);
      const missing = findings.find((finding) => finding.check === "todo: github login")!;
      expect(missing.detail).toBe("the GitHub App is not installed in stranger (it is installed in acme, other)");
      expect(missing.fix).toContain("install the GitHub App");
    });
  });
});
