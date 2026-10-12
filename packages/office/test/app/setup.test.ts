import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appState, keyPath, nameAppInEnv, prepareKeyFolder, saveKey, withAppLines } from "../../src/app/setup/credentials";
import { appManifest, manifestTarget } from "../../src/app/setup/manifest";
import { registerApp, type Fetch } from "../../src/app/setup/register-app";
import { setup, type SetupInput } from "../../src/app/setup/setup";
import { copyExamples, parseRepository, type Repository, type ShopPaths } from "../../src/app/setup/shop-files";
import { exec } from "../../src/kernel/process";
import { YamlProjectCatalog } from "../../src/projects";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nc2VjcmV0LWtleS1ib2R5\n-----END RSA PRIVATE KEY-----\n";
const CONVERTED = { id: 4242, slug: "skynot-octocat", name: "skynot-octocat", html_url: "https://github.com/apps/skynot-octocat", pem: PEM, client_secret: "shh", webhook_secret: null };

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "skynot-setup-"));
  dirs.push(dir);
  return dir;
}

function fakeGithub(answer: { status?: number; body?: unknown } = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, method: init.method });
    const status = answer.status ?? 201;
    return { ok: status < 300, status, json: async () => answer.body ?? CONVERTED };
  };
  return { fetch, calls };
}

const mode = async (file: string): Promise<number> => (await stat(file)).mode & 0o777;
const repository = (name: string): Repository => parseRepository(name) as Repository;

describe("the App's manifest", () => {
  it("asks for write on contents, issues and pull requests, read on actions and metadata, and nothing else", () => {
    expect(appManifest("skynot-octocat", "http://127.0.0.1:5000/callback").default_permissions).toEqual({
      contents: "write",
      issues: "write",
      pull_requests: "write",
      actions: "read",
      metadata: "read",
    });
  });

  it("is private, comes back to the local callback and carries no webhook", () => {
    const manifest = appManifest("skynot-octocat", "http://127.0.0.1:5000/callback");

    expect(manifest).toMatchObject({ name: "skynot-octocat", public: false, redirect_url: "http://127.0.0.1:5000/callback" });
    expect(Object.keys(manifest).filter((field) => /hook|event/.test(field))).toEqual([]);
  });

  it("is sent to the personal account's settings, or to the organization's", () => {
    expect(manifestTarget(null, "s1")).toBe("https://github.com/settings/apps/new?state=s1");
    expect(manifestTarget("skynot-labs", "s1")).toBe("https://github.com/organizations/skynot-labs/settings/apps/new?state=s1");
  });
});

describe("registering the App", () => {
  const register = (github: ReturnType<typeof fakeGithub>, announce: (url: string) => Promise<void>, timeoutMs = 5000) =>
    registerApp({ name: "skynot-octocat", organization: null, fetch: github.fetch, announce, timeoutMs, state: "expected-state" });

  it("serves a page that posts the manifest to GitHub, with the callback on the port it listens on", async () => {
    const github = fakeGithub();
    let page = "";
    let origin = "";

    await register(github, async (url) => {
      origin = new URL(url).origin;
      page = await (await fetch(url)).text();
      await fetch(`${origin}/callback?code=abc&state=expected-state`);
    });

    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(page).toContain('method="post" action="https://github.com/settings/apps/new?state=expected-state"');
    const manifest = JSON.parse(/name="manifest" value="([^"]*)"/.exec(page)![1]!.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))));
    expect(manifest).toEqual(appManifest("skynot-octocat", `${origin}/callback`));
  });

  it("exchanges the code GitHub sends back for the App's id, address and key", async () => {
    const github = fakeGithub();
    let answered = 0;

    const app = await register(github, async (url) => {
      answered = (await fetch(`${url}callback?code=abc123&state=expected-state`)).status;
    });

    expect(app).toEqual({ id: 4242, slug: "skynot-octocat", name: "skynot-octocat", htmlUrl: "https://github.com/apps/skynot-octocat", pem: PEM });
    expect(github.calls).toEqual([{ url: "https://api.github.com/app-manifests/abc123/conversions", method: "POST" }]);
    expect(answered).toBe(200);
  });

  it("refuses a callback with the wrong state or none, asks GitHub nothing for it, and keeps waiting for the right one", async () => {
    const github = fakeGithub();
    const refused: number[] = [];
    let askedAfterRefusals = -1;

    const app = await register(github, async (url) => {
      refused.push((await fetch(`${url}callback?code=abc&state=someone-else`)).status);
      refused.push((await fetch(`${url}callback?code=abc`)).status);
      askedAfterRefusals = github.calls.length;
      await fetch(`${url}callback?code=abc&state=expected-state`);
    });

    expect(refused).toEqual([400, 400]);
    expect(askedAfterRefusals).toBe(0);
    expect(app.id).toBe(4242);
  });

  it("gives up with a message when GitHub never comes back, and stops listening", async () => {
    const github = fakeGithub();
    let address = "";

    await expect(register(github, async (url) => void (address = url), 50)).rejects.toThrow(/did not come back in time/);

    await expect(fetch(address)).rejects.toThrow();
    expect(github.calls).toEqual([]);
  });

  it("says an App exists without its key when GitHub refuses the exchange, without repeating GitHub's answer", async () => {
    const github = fakeGithub({ status: 404, body: { message: "Not Found", pem: PEM } });

    const failure = await register(github, async (url) => void (await fetch(`${url}callback?code=abc&state=expected-state`))).catch((error: Error) => error);

    expect((failure as Error).message).toBe("GitHub answered 404 when asked for the App's key");
  });
});

describe("the key and .env", () => {
  it("keeps the key under the home's .config, or under XDG_CONFIG_HOME when it is set", () => {
    expect(keyPath({ home: "/home/ada" })).toBe("/home/ada/.config/skynot/app.pem");
    expect(keyPath({ home: "/home/ada", xdgConfigHome: "/srv/config" })).toBe("/srv/config/skynot/app.pem");
  });

  it("writes the key readable by its owner only, in a folder of its own", async () => {
    const key = keyPath({ home: await tempDir() });

    await prepareKeyFolder(key);
    await saveKey(key, PEM);

    expect(await readFile(key, "utf8")).toBe(PEM);
    expect(await mode(key)).toBe(0o600);
    expect(await mode(path.dirname(key))).toBe(0o700);
  });

  it("never overwrites a key that is already there", async () => {
    const key = keyPath({ home: await tempDir() });
    await prepareKeyFolder(key);
    await writeFile(key, "the director's own key");

    await expect(saveKey(key, PEM)).rejects.toThrow(/EEXIST/);

    expect(await readFile(key, "utf8")).toBe("the director's own key");
  });

  it("creates .env with the App's id and the path to its key", async () => {
    const envFile = path.join(await tempDir(), ".env");

    await nameAppInEnv(envFile, "4242", "/home/ada/.config/skynot/app.pem");

    expect(await readFile(envFile, "utf8")).toBe("SKYNOT_GITHUB_APP_ID=4242\nSKYNOT_GITHUB_APP_KEY=/home/ada/.config/skynot/app.pem\n");
  });

  it("updates only its two lines in an existing .env", async () => {
    const envFile = path.join(await tempDir(), ".env");
    await writeFile(envFile, "# mine\nPORT=5000\nSKYNOT_GITHUB_APP_KEY=/old/key.pem\n\nSKYNOT_DATA=data/elsewhere # kept\n");

    await nameAppInEnv(envFile, "4242", "/new/app.pem");

    expect(await readFile(envFile, "utf8")).toBe("# mine\nPORT=5000\nSKYNOT_GITHUB_APP_KEY=/new/app.pem\n\nSKYNOT_DATA=data/elsewhere # kept\nSKYNOT_GITHUB_APP_ID=4242\n");
  });

  it("quotes a key path that Node would otherwise cut at a #", () => {
    expect(withAppLines("", "1", "/home/a #b/app.pem")).toBe('SKYNOT_GITHUB_APP_ID=1\nSKYNOT_GITHUB_APP_KEY="/home/a #b/app.pem"\n');
  });

  it("takes the App as registered only when .env names it and its key is there", async () => {
    const dir = await tempDir();
    const envFile = path.join(dir, ".env");
    const key = keyPath({ home: dir });
    expect(await appState(envFile, key)).toEqual({ kind: "absent" });

    await prepareKeyFolder(key);
    await writeFile(key, PEM);
    expect(await appState(envFile, key)).toMatchObject({ kind: "inconsistent", problem: expect.stringContaining("never overwrites a key") });

    await nameAppInEnv(envFile, "4242", key);
    expect(await appState(envFile, key)).toEqual({ kind: "registered", appId: "4242", keyPath: key });

    await rm(key);
    expect(await appState(envFile, key)).toMatchObject({ kind: "inconsistent", problem: expect.stringContaining("is not there") });
  });
});

async function shopRoot(): Promise<ShopPaths> {
  const root = await tempDir();
  for (const example of ["policy.example.yaml", "team.example.yaml", "projects.example"]) await cp(path.join(REPO_ROOT, example), path.join(root, example), { recursive: true });
  return { root, policy: "policy.yaml", team: "team.yaml", projects: "projects" };
}

describe("the shop's files", () => {
  it("copies the three examples when none exists, into a project named after the repository", async () => {
    const paths = await shopRoot();

    const files = await copyExamples(paths, repository("octocat/Hello-World"));

    expect(files).toEqual({ created: ["policy.yaml", "team.yaml", "projects/hello-world/"], kept: [] });
    expect(await readFile(path.join(paths.root, "policy.yaml"), "utf8")).toBe(await readFile(path.join(REPO_ROOT, "policy.example.yaml"), "utf8"));
    expect(await readFile(path.join(paths.root, "team.yaml"), "utf8")).toBe(await readFile(path.join(REPO_ROOT, "team.example.yaml"), "utf8"));
    expect(await readdir(path.join(paths.root, "projects"))).toEqual(["hello-world"]);
    expect(await readdir(path.join(paths.root, "projects/hello-world"))).toEqual(await readdir(path.join(REPO_ROOT, "projects.example/example")));
  });

  it("writes the repository into the new project, which the office then reads", async () => {
    const paths = await shopRoot();

    await copyExamples(paths, repository("octocat/Hello-World"));

    const projects = await new YamlProjectCatalog(path.join(paths.root, "projects")).list();
    expect(projects.map(({ id, repo }) => ({ id, repo }))).toEqual([{ id: "hello-world", repo: "octocat/Hello-World" }]);
  });

  it("leaves an existing policy.yaml, team.yaml and projects/ byte for byte as they are", async () => {
    const paths = await shopRoot();
    await writeFile(path.join(paths.root, "policy.yaml"), "version: 1\n# the director's\n");
    await writeFile(path.join(paths.root, "team.yaml"), "# my team\n");
    await mkdir(path.join(paths.root, "projects/mine"), { recursive: true });
    await writeFile(path.join(paths.root, "projects/mine/project.yaml"), "repo: OWNER/REPO\n");

    const files = await copyExamples(paths, repository("octocat/hello-world"));

    expect(files).toEqual({ created: [], kept: ["policy.yaml", "team.yaml", "projects/"] });
    expect(await readFile(path.join(paths.root, "policy.yaml"), "utf8")).toBe("version: 1\n# the director's\n");
    expect(await readFile(path.join(paths.root, "team.yaml"), "utf8")).toBe("# my team\n");
    expect(await readdir(path.join(paths.root, "projects"))).toEqual(["mine"]);
    expect(await readFile(path.join(paths.root, "projects/mine/project.yaml"), "utf8")).toBe("repo: OWNER/REPO\n");
  });

  it("copies only what is missing", async () => {
    const paths = await shopRoot();
    await writeFile(path.join(paths.root, "policy.yaml"), "# the director's\n");

    const files = await copyExamples(paths, repository("octocat/hello-world"));

    expect(files).toEqual({ created: ["team.yaml", "projects/hello-world/"], kept: ["policy.yaml"] });
    expect(await readFile(path.join(paths.root, "policy.yaml"), "utf8")).toBe("# the director's\n");
  });

  it("takes owner/name, or the repository's address, and names the project folder after it", () => {
    expect(parseRepository(" octocat/Hello.World ")).toEqual({ name: "octocat/Hello.World", owner: "octocat", projectId: "hello-world" });
    expect(parseRepository("https://github.com/octocat/hello-world.git")).toMatchObject({ name: "octocat/hello-world" });
  });

  it.each(["", "hello-world", "octocat/", "octocat/hello world", "octocat/a/b", "-octocat/repo", "OWNER/REPO", "octocat/repo;rm"])("refuses %j as a repository", (answer) => {
    expect(parseRepository(answer)).toEqual(expect.stringContaining("is not a repository"));
  });

  it("refuses a repository whose name cannot be a project folder", () => {
    expect(parseRepository("octocat/9")).toEqual(expect.stringContaining("cannot name a project folder"));
  });
});

describe("npm run setup", () => {
  async function shop(answers: string[], overrides: Partial<SetupInput> = {}) {
    const paths = await shopRoot();
    const home = await tempDir();
    const github = fakeGithub();
    const said: string[] = [];
    const asked: string[] = [];
    const opened: string[] = [];
    const checked: Array<Record<string, string>> = [];
    const pending = [...answers];
    const input: SetupInput = {
      paths,
      home: { home },
      fetch: github.fetch,
      timeoutMs: 5000,
      say: (line) => void said.push(line),
      ask: async (question) => {
        asked.push(question);
        const answer = pending.shift();
        if (answer === undefined) throw new Error(`nothing left to answer to: ${question}`);
        return answer;
      },
      // Stands for the director confirming on GitHub, which then sends the browser back with the code.
      open: async (url) => {
        opened.push(url);
        const state = /state=([0-9a-f]+)/.exec(await (await fetch(url)).text())![1];
        await fetch(`${url}callback?code=abc&state=${state}`);
      },
      check: async (app) => void checked.push(app),
      ...overrides,
    };
    return { input, paths, key: keyPath({ home }), envFile: path.join(paths.root, ".env"), github, said, asked, opened, checked };
  }

  it("says what it will create and waits before anything reaches GitHub", async () => {
    const run = await shop(["octocat/hello-world", ""]);

    await expect(setup(run.input)).rejects.toThrow(/nothing left to answer/);

    const announced = run.said.join("\n");
    expect(announced).toContain("skynot-octocat");
    expect(announced).toContain("contents: write, issues: write, pull requests: write, actions: read, metadata: read");
    expect(announced).toContain("your personal account");
    expect(run.asked.at(-1)).toMatch(/Press Enter to continue/);
    expect(run.opened).toEqual([]);
    expect(run.github.calls).toEqual([]);
  });

  it("creates the App, keeps its key outside the repository, writes the files and checks the shop as that App", async () => {
    const run = await shop(["octocat/hello-world", "", "", ""]);

    await setup(run.input);

    expect(await readFile(run.key, "utf8")).toBe(PEM);
    expect(await mode(run.key)).toBe(0o600);
    expect(await readFile(run.envFile, "utf8")).toBe(`SKYNOT_GITHUB_APP_ID=4242\nSKYNOT_GITHUB_APP_KEY=${run.key}\n`);
    expect((await new YamlProjectCatalog(path.join(run.paths.root, "projects")).list()).map((project) => project.repo)).toEqual(["octocat/hello-world"]);
    expect(run.said.join("\n")).toContain("https://github.com/apps/skynot-octocat/installations/new");
    expect(run.checked).toEqual([{ SKYNOT_GITHUB_APP_ID: "4242", SKYNOT_GITHUB_APP_KEY: run.key }]);
    expect(run.said.join("\n")).not.toContain("c2VjcmV0LWtleS1ib2R5");
  });

  it("sends the manifest to the organization that will own the App", async () => {
    const run = await shop(["octocat/hello-world", "not an org", "skynot-labs", "", ""]);
    let action = "";
    const confirm = run.input.open;

    await setup({
      ...run.input,
      open: async (url) => {
        action = /action="([^"]*)"/.exec(await (await fetch(url)).text())![1]!;
        await confirm(url);
      },
    });

    expect(action).toMatch(/^https:\/\/github\.com\/organizations\/skynot-labs\/settings\/apps\/new\?state=/);
    expect(run.said.join("\n")).toContain("skynot-skynot-labs");
  });

  it("asks again for a repository that is not one", async () => {
    const run = await shop(["not a repo", "octocat/hello-world", "", "", ""]);

    await setup(run.input);

    expect(run.said[0]).toContain("is not a repository");
    expect(await readdir(path.join(run.paths.root, "projects"))).toEqual(["hello-world"]);
  });

  it("run again after it succeeded, asks GitHub nothing and changes no file", async () => {
    const run = await shop(["octocat/hello-world", "", "", ""]);
    await setup(run.input);
    const before = await snapshot(run.paths.root, run.key);
    const again = { asked: [] as string[], opened: [] as string[] };

    await setup({
      ...run.input,
      ask: async (question) => {
        again.asked.push(question);
        return "";
      },
      open: (url) => void again.opened.push(url),
    });

    expect(run.github.calls).toHaveLength(1);
    expect(again).toEqual({ asked: [], opened: [] });
    expect(await snapshot(run.paths.root, run.key)).toEqual(before);
    expect(run.checked).toEqual([{ SKYNOT_GITHUB_APP_ID: "4242", SKYNOT_GITHUB_APP_KEY: run.key }, {}]);
  });

  it("stops before GitHub when a key is there that .env does not name", async () => {
    const run = await shop(["octocat/hello-world", "", "", ""]);
    await prepareKeyFolder(run.key);
    await writeFile(run.key, "the director's own key");

    await expect(setup(run.input)).rejects.toThrow(/never overwrites a key/);

    expect(run.asked).toEqual([]);
    expect(run.github.calls).toEqual([]);
    expect(await readFile(run.key, "utf8")).toBe("the director's own key");
  });

  it("says which App is left on GitHub and how to delete it when it cannot keep the key, without showing the key", async () => {
    const run = await shop(["octocat/hello-world", "", "", ""]);
    const confirm = run.input.open;

    const failure = await setup({
      ...run.input,
      // A key that appears while the director is on GitHub's page: the write must refuse it.
      open: async (url) => {
        await writeFile(run.key, "someone else's key");
        await confirm(url);
      },
    }).catch((error: Error) => error);

    const message = (failure as Error).message;
    expect(message).toContain("skynot-octocat");
    expect(message).toContain("https://github.com/apps/skynot-octocat");
    expect(message).toContain("https://github.com/settings/apps/skynot-octocat/advanced");
    expect(message + run.said.join("\n")).not.toContain("c2VjcmV0LWtleS1ib2R5");
    expect(await readFile(run.key, "utf8")).toBe("someone else's key");
    await expect(stat(run.envFile)).rejects.toThrow(/ENOENT/);
    await expect(stat(path.join(run.paths.root, "policy.yaml"))).rejects.toThrow(/ENOENT/);
    expect(run.checked).toEqual([]);
  });

  it("removes the key it wrote when .env cannot be written, so the next run starts clean", async () => {
    const run = await shop(["octocat/hello-world", "", "", ""]);
    const confirm = run.input.open;

    const failure = await setup({
      ...run.input,
      open: async (url) => {
        await mkdir(run.envFile);
        await confirm(url);
      },
    }).catch((error: Error) => error);

    expect((failure as Error).message).toContain("https://github.com/settings/apps/skynot-octocat/advanced");
    await expect(stat(run.key)).rejects.toThrow(/ENOENT/);
  });

  it("says an App may be left on GitHub when its key could not be fetched", async () => {
    const run = await shop(["octocat/hello-world", "skynot-labs", "", ""]);
    const github = fakeGithub({ status: 500 });

    const failure = await setup({ ...run.input, fetch: github.fetch }).catch((error: Error) => error);

    expect((failure as Error).message).toContain("skynot-skynot-labs");
    expect((failure as Error).message).toContain("https://github.com/organizations/skynot-labs/settings/apps");
    await expect(stat(run.key)).rejects.toThrow(/ENOENT/);
  });
});

async function snapshot(root: string, key: string): Promise<Record<string, string>> {
  const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
  const read = await Promise.all([...files, key].sort().map(async (file) => [file, `${(await stat(file)).mtimeMs} ${await readFile(file, "utf8")}`] as const));
  return Object.fromEntries(read);
}

describe("the office's entries and .env", () => {
  const scripts = async (): Promise<Record<string, string>> => (JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  // The start script, with its entry swapped for one that reads .env as the entries do and prints a variable.
  async function startPrinting(cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
    const [, ...args] = (await scripts()).start!.split(" ");
    args[args.indexOf("--tsconfig") + 1] = path.join(REPO_ROOT, "packages/office/tsconfig.json");
    args[args.length - 1] = path.join(import.meta.dirname, "prints-env.fixture.ts");
    const result = await exec(path.join(REPO_ROOT, "node_modules/.bin/tsx"), args, { cwd, env });
    expect(result.code).toBe(0);
    return result.stdout;
  }

  const withoutProbe = (): NodeJS.ProcessEnv => {
    const { SKYNOT_SETUP_PROBE: _, ...env } = process.env;
    return env;
  };

  it("gives the office a value written in .env", async () => {
    const cwd = await tempDir();
    await writeFile(path.join(cwd, ".env"), "SKYNOT_SETUP_PROBE=from-the-file\n");

    expect(await startPrinting(cwd, withoutProbe())).toBe("from-the-file");
  });

  it("lets a variable of the real environment win over .env", async () => {
    const cwd = await tempDir();
    await writeFile(path.join(cwd, ".env"), "SKYNOT_SETUP_PROBE=from-the-file\n");

    expect(await startPrinting(cwd, { ...withoutProbe(), SKYNOT_SETUP_PROBE: "from-the-environment" })).toBe("from-the-environment");
  });

  it("starts without a .env", async () => {
    expect(await startPrinting(await tempDir(), withoutProbe())).toBe("none");
  });

  it("reads .env first in every entry that starts the office or checks it", async () => {
    for (const entry of ["main", "check", "stats", "setup"]) {
      const source = await readFile(path.join(REPO_ROOT, `packages/office/src/app/${entry}.ts`), "utf8");

      expect(source.startsWith('import "./env-file";\n'), entry).toBe(true);
    }
  });
});
