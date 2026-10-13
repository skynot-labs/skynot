import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { FakeEngine } from "../../src/execution";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

const team: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };

let dataDir: string;
let shop: Shop;
let vcs: FakeVcs;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-closed-pull-request-"));
  vcs = new FakeVcs();
  const developer = new FakeEngine(async () => ({ text: "evidence: the new test passes" }));
  shop = await createShop({ policy: examplePolicy(), dataDir, team, engines: { claude: createMockManager(), codex: developer }, vcs, workspace: new FakeWorkspace() });
});

afterEach(async () => {
  shop.stop();
  await rm(dataDir, { recursive: true, force: true });
});

async function signed(spec: Parameters<typeof validSpec>[0] = {}): Promise<string> {
  const proposed = await shop.orderService.propose(validSpec(spec));
  if (!proposed.ok) throw new Error(proposed.error.message);
  await shop.orderService.sign(proposed.value.id);
  await shop.flow.idle();
  return proposed.value.id;
}

const pullRequestOf = (id: string) => shop.orders.get(id)!.pullRequest!;

describe("a pull request closed without merging", () => {
  it("can be discarded, as the block's notice and the docs say", async () => {
    const id = await signed();
    vcs.setPullRequestState(shop.repo, pullRequestOf(id), "closed");
    await shop.watcher.poll();
    expect(shop.activity.linksFor(id).blocked).toBe("the pull request was closed without merging");

    const discarded = await shop.flow.discard(id);

    expect(discarded).toMatchObject({ ok: true });
    expect(shop.orders.get(id)?.status).toBe("discarded");
  });

  it("cannot be discarded while its pull request is open and nothing blocks it", async () => {
    const id = await signed();

    expect(await shop.flow.discard(id)).toMatchObject({ ok: false, error: { kind: "invalid_transition" } });
    expect(shop.orders.get(id)?.status).toBe("in_review");
  });

  it("stops being blocked once the pull request is reopened", async () => {
    const id = await signed();
    vcs.setPullRequestState(shop.repo, pullRequestOf(id), "closed");
    await shop.watcher.poll();

    vcs.setPullRequestState(shop.repo, pullRequestOf(id), "open");
    await shop.watcher.poll();

    expect(shop.activity.linksFor(id).blocked).toBeNull();
  });
});
