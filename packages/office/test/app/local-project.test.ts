import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { commandPath } from "@skynot/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi } from "../../src/app/http/api";
import { readState } from "../../src/app/http/state";
import { createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeEngine } from "../../src/execution";
import { exec, type Exec } from "../../src/kernel/process";
import type { Project } from "../../src/projects";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";
import { addFiles, git } from "../delivery/git-fixture";

const HOST = "127.0.0.1:4747";
const team: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };
const listo: Project = { id: "listo", name: null, description: null, repo: "listo", local: true, baseBranch: "main", setupCommand: null, verifyCommands: ["test -f src/feature.txt"], protectedPaths: [".github/"] };

let dataDir: string;
let shop: Shop;
let calledGithub: string[];

// Any call to gh fails the run it belongs to, and is recorded so the test can say none happened.
const withoutGithub: Exec = (command, args, options) => {
  if (command === "gh") {
    calledGithub.push(args.join(" "));
    return Promise.resolve({ stdout: "", stderr: "no GitHub here", code: 1 });
  }
  return exec(command, args, options);
};

const developerWriting = (content: string) =>
  new FakeEngine(async (request) => {
    await mkdir(path.join(request.cwd, "src"), { recursive: true });
    await writeFile(path.join(request.cwd, "src/feature.txt"), content);
    return { text: "Criterion 1: the file is there." };
  });

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-local-shop-"));
  calledGithub = [];
});

afterEach(async () => {
  await shop.manager.idle();
  await shop.flow.idle();
  shop.stop();
  await rm(dataDir, { recursive: true, force: true });
});

async function open(content = "feature\n"): Promise<Shop> {
  shop = await createShop({ policy: examplePolicy(), dataDir, team, projects: [listo], engines: { claude: createMockManager(), codex: developerWriting(content) }, exec: withoutGithub });
  return shop;
}

async function signedOrder(idea: string): Promise<string> {
  await shop.manager.handleMessage(idea);
  const [question] = shop.chat.openDecisions();
  await shop.manager.answerDecision(question!.id, "Keep it small");
  const id = shop.chat.messages().at(-1)!.orderId!;
  await shop.orderService.sign(id);
  await shop.flow.idle();
  return id;
}

const origin = () => path.join(dataDir, "origins", "listo.git");

async function pushToBaseByHand(files: Record<string, string>): Promise<void> {
  const clone = path.join(dataDir, `by-hand-${Date.now()}`);
  await git(dataDir, "clone", "--quiet", origin(), clone);
  await addFiles(clone, files);
  await git(clone, "add", "-A");
  await git(clone, "commit", "-qm", "By hand");
  await git(clone, "push", "-q", "origin", "HEAD:main");
}

describe("a project kept on this machine", () => {
  it("takes an order from signed to delivered on the base branch of its own repository, without calling GitHub", async () => {
    await open();

    const id = await signedOrder("Add a feature file");
    expect(shop.orders.get(id)).toMatchObject({ status: "in_review", pullRequest: 2 });
    await expect(git(origin(), "show", "main:src/feature.txt")).rejects.toThrow();

    expect(await shop.mergeHere(id)).toBe("merged");

    expect(shop.orders.get(id)?.status).toBe("delivered");
    expect(await git(origin(), "show", "main:src/feature.txt")).toBe("feature\n");
    expect(calledGithub).toEqual([]);
  });

  it("tells the studio the project is local, and never gives it a link to GitHub", async () => {
    await open();
    const id = await signedOrder("Add a feature file");

    const state = readState(shop, "listo");
    const order = state.orders.find((candidate) => candidate.id === id)!;

    expect(state.project).toMatchObject({ repo: "listo", local: true });
    expect(order.issueUrl ?? "").not.toContain("github.com");
    expect(order.pullRequestUrl ?? "").not.toContain("github.com");
  });

  it("refuses to merge an order that is not in review", async () => {
    await open();
    await shop.manager.handleMessage("Add a feature file");
    const [question] = shop.chat.openDecisions();
    await shop.manager.answerDecision(question!.id, "Keep it small");
    const id = shop.chat.messages().at(-1)!.orderId!;

    expect(await shop.mergeHere(id)).toBe("not_open");
    expect(shop.orders.get(id)?.status).toBe("awaiting_signature");
  });

  it("merges from the studio, and answers a conflict with the base branch without delivering", async () => {
    await open();
    const api = createApi(shop, { allowedHosts: [HOST] });
    const merge = (orderId: string) =>
      api.request(commandPath("merge-pull-request"), { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: JSON.stringify({ orderId }) });
    const id = await signedOrder("Add a feature file");
    await pushToBaseByHand({ "src/feature.txt": "the director's own\n" });

    const conflicting = await merge(id);

    expect(conflicting.status).toBe(409);
    expect(shop.orders.get(id)?.status).toBe("in_review");
    expect(await git(origin(), "show", "main:src/feature.txt")).toBe("the director's own\n");

    await pushToBaseByHand({ "src/feature.txt": "feature\n" });
    expect((await merge(id)).status).toBe(200);
    expect(shop.orders.get(id)?.status).toBe("delivered");
  });
});

describe("the commands a project is checked with", () => {
  it("are the ones the director signed from the next order on, without a restart, and project.yaml says the same", async () => {
    const projectsDir = path.join(dataDir, "projects");
    await mkdir(path.join(projectsDir, "listo"), { recursive: true });
    await writeFile(path.join(projectsDir, "listo", "project.yaml"), 'version: 1\nlocal: true\nbase_branch: main\nsetup_command: null\nverify_commands: ["true"]\nprotected_paths: []\n');
    shop = await createShop({ policy: examplePolicy(), dataDir, team, projects: [{ ...listo, verifyCommands: ["true"] }], projectsDir, engines: { claude: createMockManager(), codex: developerWriting("feature\n") }, exec: withoutGithub });

    const proposed = await shop.commandsService.propose("listo", { setupCommand: null, verifyCommands: ["test -f src/missing.txt"] }, "the tests exist now");
    if (!proposed.ok) throw new Error(proposed.error.message);
    expect((await shop.commandsService.sign(proposed.value.id)).ok).toBe(true);

    const id = await signedOrder("Add a feature file");

    expect(shop.orders.get(id)?.status).not.toBe("in_review");
    expect(shop.activity.linksFor(id).blocked).toContain("test -f src/missing.txt");
    expect(await readFile(path.join(projectsDir, "listo", "project.yaml"), "utf8")).toContain("test -f src/missing.txt");
  });
});

describe("a project on GitHub", () => {
  it("cannot be merged from the studio of a real office", async () => {
    shop = await createShop({ policy: examplePolicy(), dataDir, team, projects: [{ ...listo, id: "widgets", repo: "acme/widgets", local: false }], engines: { claude: createMockManager(), codex: developerWriting("x") }, exec: withoutGithub });
    const api = createApi(shop, { allowedHosts: [HOST] });

    const response = await api.request(commandPath("merge-pull-request"), { method: "POST", headers: { host: HOST, "content-type": "application/json" }, body: JSON.stringify({ orderId: "WO-0001" }) });

    expect(response.status).toBe(404);
  });
});
