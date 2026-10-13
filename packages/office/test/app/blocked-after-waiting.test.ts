import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { FakeEngine } from "../../src/execution";
import type { IssueRef } from "../../src/delivery";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

const team: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };

class FlakyVcs extends FakeVcs {
  refuseIssues = false;

  override async createIssue(repo: string, title: string, body: string): Promise<IssueRef> {
    if (this.refuseIssues) throw new Error("HTTP 502");
    return super.createIssue(repo, title, body);
  }
}

let dataDir: string;
let shop: Shop;
let vcs: FlakyVcs;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-blocked-after-waiting-"));
  vcs = new FlakyVcs();
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

describe("an order that blocked after the order it waited for was merged", () => {
  it("stays blocked until the director retries it, whatever else is delivered", async () => {
    const first = await signed({ title: "First on the file" });
    const waiting = await signed({ title: "Second on the file" });
    expect(shop.activity.linksFor(waiting).waitingOn).toEqual([first]);

    vcs.refuseIssues = true;
    vcs.setPullRequestState(shop.repo, pullRequestOf(first), "merged");
    await shop.watcher.poll();
    await shop.flow.idle();
    expect(shop.orders.get(waiting)?.status).toBe("signed");
    expect(shop.activity.linksFor(waiting).blocked).toBe("GitHub refused: HTTP 502");
    vcs.refuseIssues = false;

    const unrelated = await signed({ title: "Something else", likelyFiles: ["docs/other.md"] });
    vcs.setPullRequestState(shop.repo, pullRequestOf(unrelated), "merged");
    await shop.watcher.poll();
    await shop.flow.idle();

    expect(shop.activity.linksFor(waiting).waitingOn).toEqual([]);
    expect({ status: shop.orders.get(waiting)?.status, blocked: shop.activity.linksFor(waiting).blocked }).toEqual({ status: "signed", blocked: "GitHub refused: HTTP 502" });
  });
});
