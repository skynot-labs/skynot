import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FakeVcs,
  GitWorkspace,
  Implementer,
  IssueFiler,
  type DeliveryRules,
  type WorkItem,
  type WorkerRunner,
} from "../../src/delivery";
import { err, fixedClock, ok, type Result } from "../../src/kernel";
import { EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { addFiles, cloneFrom, createSandbox, git, type Sandbox } from "./git-fixture";

const item: WorkItem = {
  id: "WO-0001",
  title: "Add the feature",
  objective: "The feature file exists.",
  criteria: [{ statement: "src/feature.txt exists", verification: { kind: "command", detail: "test -f src/feature.txt" } }],
  outOfScope: [],
  risk: "low",
  likelyFiles: ["src/feature.txt"],
  card: "WO-0001  Add the feature",
};

const FAKE_NPM_INSTALL = `node ${path.resolve("packages/office/test/delivery/fake-npm-install.mjs")}`;

function createRules(overrides: Partial<DeliveryRules> = {}): DeliveryRules {
  return {
    maxRounds: 2,
    workerTimeoutMs: 5000,
    workerMaxUsd: 1,
    repo: (name) =>
      name === "acme/widgets"
        ? ok({ baseBranch: "main", setupCommand: null, installCommand: FAKE_NPM_INSTALL, verifyCommands: ["test -f src/feature.txt"], protectedPaths: [".github/"] })
        : err(`${name} is not in policy.yaml`),
    branchFor: (orderId) => ok(`taller/${orderId.toLowerCase()}`),
    triggerLabel: () => ok("taller:implement"),
    protectedTouched: (_repo, paths) => paths.filter((candidate) => candidate.startsWith(".github/")),
    spend: async () => ok(undefined),
    ...overrides,
  };
}

type WorkerStep = (dir: string, prompt: string) => Promise<Result<string, string>>;

function scriptedWorker(steps: WorkerStep[]) {
  const prompts: string[] = [];
  const worker: WorkerRunner = {
    async work({ cwd, prompt }) {
      prompts.push(prompt);
      const step = steps.shift();
      if (!step) throw new Error("the worker script ran out");
      const result = await step(cwd, prompt);
      return result.ok ? ok({ report: result.value, costUsd: 0.5 }) : err(result.error);
    },
  };
  return { worker, prompts };
}

const writes = (files: Record<string, string>, report = "done"): WorkerStep => async (dir) => {
  await addFiles(dir, files);
  return ok(report);
};

let sandbox: Sandbox;

beforeEach(async () => {
  sandbox = await createSandbox();
});

afterEach(() => sandbox.cleanup());

async function setup(steps: WorkerStep[], rules = createRules(), setupCommand: string | null = null) {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-09T12:00:00.000Z")));
  const vcs = new FakeVcs();
  const workspaceRoot = path.join(sandbox.root, "shop");
  const workspace = new GitWorkspace({ root: workspaceRoot, clone: cloneFrom(sandbox.origin) });
  const { worker, prompts } = scriptedWorker(steps);
  const effectiveRules: DeliveryRules = setupCommand
    ? { ...rules, repo: (name) => { const base = rules.repo(name); return base.ok ? ok({ ...base.value, setupCommand }) : base; } }
    : rules;
  const implementer = new Implementer({ log, vcs, workspace, worker, rules: effectiveRules });
  const filer = new IssueFiler({ log, vcs, rules: effectiveRules });
  const events = async () => (await log.readAfter(0)).map((event) => event.type);
  const originBranches = async () => (await git(sandbox.origin, "branch", "--list")).split("\n").map((line) => line.replace("*", "").trim()).filter(Boolean);
  return { implementer, filer, vcs, prompts, events, originBranches, workspaceRoot, log };
}

describe("implementer", () => {
  it("verifies the worker's change itself, then pushes the branch and opens the pull request", async () => {
    const { implementer, vcs, events, originBranches } = await setup([writes({ "src/feature.txt": "feature\n" }, "criterion 1: test -f passed")]);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome).toMatchObject({ ok: true, value: { number: 1 } });
    expect(vcs.pullRequests).toMatchObject([{ head: "taller/wo-0001", base: "main", title: "WO-0001 Add the feature" }]);
    expect(vcs.pullRequests[0]?.body).toContain("Closes #7");
    expect(vcs.pullRequests[0]?.body).toContain("criterion 1: test -f passed");
    expect(await originBranches()).toContain("taller/wo-0001");
    expect((await git(sandbox.origin, "log", "-1", "--format=%s", "taller/wo-0001")).trim()).toBe("WO-0001: Add the feature");
    expect(await events()).toEqual(["delivery.pull_request_opened"]);
  });

  it("removes its worktree when it is done", async () => {
    const { implementer, workspaceRoot } = await setup([writes({ "src/feature.txt": "x" })]);

    await implementer.implement(item, "acme/widgets", 7);

    expect(await readdir(path.join(workspaceRoot, "worktrees/acme/widgets"))).toEqual([]);
  });

  it("blocks without pushing when the worker changed nothing", async () => {
    const { implementer, vcs, events, originBranches } = await setup([async () => ok("nothing to do")]);

    expect(await implementer.implement(item, "acme/widgets", 7)).toEqual({ ok: false, error: "the worker changed nothing" });

    expect(vcs.pullRequests).toEqual([]);
    expect(await originBranches()).toEqual(["main"]);
    expect(await events()).toEqual(["delivery.work_blocked"]);
  });

  it("blocks when the change touches a protected path", async () => {
    const { implementer, vcs, originBranches } = await setup([writes({ "src/feature.txt": "x", ".github/workflows/ci.yml": "on: push" })]);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining(".github/workflows/ci.yml") });
    expect(vcs.pullRequests).toEqual([]);
    expect(await originBranches()).toEqual(["main"]);
  });

  it("blocks a protected path whose name git would quote", async () => {
    const { implementer, vcs, originBranches } = await setup([writes({ "src/feature.txt": "x", ".github/workflows/my déploy.yml": "on: push" })]);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining(".github/workflows/my déploy.yml") });
    expect(vcs.pullRequests).toEqual([]);
    expect(await originBranches()).toEqual(["main"]);
  });

  it("blocks what the verify commands write, not only what the worker wrote", async () => {
    const script = "mkdir -p .github && echo 'on: push' > .github/sneaky.yml && rm test/app.test.txt";
    const rules = createRules({
      repo: () => ok({ baseBranch: "main", setupCommand: null, installCommand: FAKE_NPM_INSTALL, verifyCommands: ["sh ./check.sh"], protectedPaths: [".github/"] }),
    });
    const { implementer, vcs, originBranches } = await setup([writes({ "check.sh": script })], rules);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining(".github/sneaky.yml") });
    expect(vcs.pullRequests).toEqual([]);
    expect(await originBranches()).toEqual(["main"]);
  });

  it("blocks when the worker deletes a test", async () => {
    const deletesTest: WorkerStep = async (dir) => {
      await rm(path.join(dir, "test/app.test.txt"));
      await addFiles(dir, { "src/feature.txt": "x" });
      return ok("removed a flaky test");
    };
    const { implementer, vcs } = await setup([deletesTest]);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome).toMatchObject({ ok: false, error: "it deletes the test test/app.test.txt" });
    expect(vcs.pullRequests).toEqual([]);
  });

  it("blocks when the worker moves a test out of the tests with git mv", async () => {
    const movesTestAway: WorkerStep = async (dir) => {
      await addFiles(dir, { "src/feature.txt": "x" });
      await git(dir, "mv", "test/app.test.txt", "src/moved.txt");
      return ok("moved a flaky test aside");
    };
    const { implementer, vcs } = await setup([movesTestAway]);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome).toMatchObject({ ok: false, error: "it deletes the test test/app.test.txt" });
    expect(vcs.pullRequests).toEqual([]);
  });

  it("lets the worker rename a test within the tests", async () => {
    const renamesTest: WorkerStep = async (dir) => {
      await addFiles(dir, { "src/feature.txt": "x" });
      await git(dir, "mv", "test/app.test.txt", "test/feature.test.txt");
      return ok("renamed the test after the feature");
    };
    const { implementer, vcs } = await setup([renamesTest]);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome.ok).toBe(true);
    expect(vcs.pullRequests).toHaveLength(1);
  });

  describe("dependencies", () => {
    const needsLibraries: WorkItem = { ...item, dependencies: [{ name: "zod", dev: false }, { name: "@types/node", dev: true }] };
    const seesLibraries = createRules({
      repo: () => ok({ baseBranch: "main", setupCommand: null, installCommand: FAKE_NPM_INSTALL, verifyCommands: ["test -f node_modules/zod/index.js", "test -f node_modules/@types/node/index.js"], protectedPaths: [".github/"] }),
    });

    it("installs the dependencies the order declares before the worker starts, and its verification sees them", async () => {
      const seen: string[] = [];
      const { implementer, vcs } = await setup([async (dir) => (seen.push(await readFile(path.join(dir, "package.json"), "utf8")), ok("done"))], seesLibraries);

      const outcome = await implementer.implement(needsLibraries, "acme/widgets", 7);

      expect(outcome.ok).toBe(true);
      expect(JSON.parse(seen[0]!)).toEqual({ dependencies: { zod: "^1.0.0" }, devDependencies: { "@types/node": "^1.0.0" } });
      expect(vcs.pullRequests).toHaveLength(1);
    });

    it("tells the worker what was installed, and that it may add nothing else", async () => {
      const { implementer, prompts } = await setup([writes({ "src/feature.txt": "x" })]);

      await implementer.implement({ ...item, dependencies: [{ name: "zod", dev: false }] }, "acme/widgets", 7);

      expect(prompts[0]).toContain("installed zod before you started");
    });

    it("refuses a change that adds a dependency the order did not declare", async () => {
      const sneaks = writes({ "src/feature.txt": "x", "package.json": JSON.stringify({ dependencies: { zod: "^1.0.0", "left-pad": "^1.3.0" } }) });
      const { implementer, vcs, events } = await setup([sneaks], seesLibraries);

      const outcome = await implementer.implement({ ...item, dependencies: [{ name: "zod", dev: false }] }, "acme/widgets", 7);

      expect(outcome).toEqual({ ok: false, error: "it adds left-pad to the dependencies, which the order did not declare" });
      expect(vcs.pullRequests).toHaveLength(0);
      expect(await events()).toContain("delivery.work_blocked");
    });

    it("runs no install command for an order that declares nothing, and still refuses a dependency the worker adds", async () => {
      const { implementer, vcs } = await setup([writes({ "src/feature.txt": "x", "package.json": JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }) })], createRules({
        repo: () => ok({ baseBranch: "main", setupCommand: null, installCommand: `echo installed >> ${path.join(sandbox.root, "ran.txt")}`, verifyCommands: ["test -f src/feature.txt"], protectedPaths: [] }),
      }));

      const outcome = await implementer.implement(item, "acme/widgets", 7);

      await expect(stat(path.join(sandbox.root, "ran.txt"))).rejects.toThrow();
      expect(outcome).toEqual({ ok: false, error: "it adds vitest to the dependencies, which the order did not declare" });
      expect(vcs.pullRequests).toHaveLength(0);
    });

    it("blocks before the worker runs when the install fails", async () => {
      const { implementer, prompts } = await setup([writes({ "src/feature.txt": "x" })], createRules({
        repo: () => ok({ baseBranch: "main", setupCommand: null, installCommand: "false", verifyCommands: ["true"], protectedPaths: [] }),
      }));

      const outcome = await implementer.implement(needsLibraries, "acme/widgets", 7);

      expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("installing zod failed") });
      expect(prompts).toEqual([]);
    });
  });

  it("gives the worker the failed verification output and accepts the repaired attempt", async () => {
    const { implementer, vcs, prompts } = await setup([
      writes({ "src/other.txt": "wrong file" }),
      writes({ "src/feature.txt": "right file" }),
    ]);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome.ok).toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).not.toContain("previous attempt");
    expect(prompts[1]).toContain("previous attempt failed verification");
    expect(prompts[1]).toContain("$ test -f src/feature.txt");
    expect(vcs.pullRequests).toHaveLength(1);
  });

  it("blocks without pushing when verification still fails after the allowed rounds", async () => {
    const { implementer, vcs, prompts, originBranches } = await setup([writes({ "src/a.txt": "1" }), writes({ "src/b.txt": "2" })]);

    const outcome = await implementer.implement(item, "acme/widgets", 7);

    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("verification still fails after 2 rounds") });
    expect(prompts).toHaveLength(2);
    expect(vcs.pullRequests).toEqual([]);
    expect(await originBranches()).toEqual(["main"]);
  });

  it("blocks when the setup command fails, before the worker runs", async () => {
    const { implementer, prompts } = await setup([], createRules(), "echo no network >&2; exit 1");

    expect(await implementer.implement(item, "acme/widgets", 7)).toMatchObject({ ok: false, error: expect.stringContaining("setup failed: no network") });
    expect(prompts).toEqual([]);
  });

  it("reports a worker failure as a block", async () => {
    const { implementer, events } = await setup([async () => err("codex timed out")]);

    expect(await implementer.implement(item, "acme/widgets", 7)).toEqual({ ok: false, error: "the worker failed: codex timed out" });
    expect(await events()).toEqual(["delivery.work_blocked"]);
  });

  it("does not push or open a pull request once the action budget is spent", async () => {
    const rules = createRules({ spend: async () => err("WO-0001 reached its limit of 12 actions today") });
    const { implementer, vcs, originBranches } = await setup([writes({ "src/feature.txt": "x" })], rules);

    expect(await implementer.implement(item, "acme/widgets", 7)).toMatchObject({ ok: false, error: expect.stringContaining("limit") });
    expect(vcs.pullRequests).toEqual([]);
    expect(await originBranches()).toEqual(["main"]);
  });

  it("refuses a repository that is not in the policy", async () => {
    const { implementer, prompts } = await setup([]);

    expect(await implementer.implement(item, "acme/other", 7)).toMatchObject({ ok: false, error: expect.stringContaining("not in policy.yaml") });
    expect(prompts).toEqual([]);
  });

  it("leaves no worktree behind when a step throws", async () => {
    const { implementer, workspaceRoot } = await setup([async () => { throw new Error("boom"); }]);

    expect(await implementer.implement(item, "acme/widgets", 7)).toEqual({ ok: false, error: "boom" });
    await expect(stat(path.join(workspaceRoot, "worktrees/acme/widgets/taller-wo-0001"))).rejects.toThrow();
  });
});

describe("issue filer", () => {
  it("opens the issue with the card and labels it to start the work", async () => {
    const { filer, vcs, events } = await setup([]);

    const outcome = await filer.file(item, "acme/widgets");

    expect(outcome).toMatchObject({ ok: true, value: { number: 1 } });
    expect(vcs.issues).toMatchObject([{ repo: "acme/widgets", title: "WO-0001 Add the feature", labels: ["taller:implement"] }]);
    expect(vcs.issues[0]?.body.startsWith("```\nWO-0001  Add the feature")).toBe(true);
    expect(await events()).toEqual(["delivery.issue_opened"]);
  });

  it("creates nothing for a repository outside the policy", async () => {
    const { filer, vcs, events } = await setup([]);

    expect(await filer.file(item, "acme/other")).toMatchObject({ ok: false });
    expect(vcs.issues).toEqual([]);
    expect(await events()).toEqual(["delivery.work_blocked"]);
  });

  it("creates nothing once the action budget is spent", async () => {
    const { filer, vcs } = await setup([], createRules({ spend: async () => err("the daily limit of 60 actions is reached") }));

    expect(await filer.file(item, "acme/widgets")).toMatchObject({ ok: false, error: expect.stringContaining("daily limit") });
    expect(vcs.issues).toEqual([]);
  });

  it("keeps the record of an issue it opened even when labelling fails", async () => {
    const { filer, vcs, events } = await setup([]);
    vcs.addLabel = async () => {
      throw new Error("label does not exist");
    };

    expect(await filer.file(item, "acme/widgets")).toMatchObject({ ok: false, error: expect.stringContaining("label does not exist") });
    expect(await events()).toEqual(["delivery.issue_opened", "delivery.work_blocked"]);
  });
});
