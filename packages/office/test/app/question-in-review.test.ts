import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inboxOf } from "../../src/app/inbox";
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
let reports: string[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-question-in-review-"));
  vcs = new FakeVcs();
  reports = [];
  const developer = new FakeEngine(async () => ({ text: reports.shift() ?? "evidence: the new test passes" }));
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

describe("a worker's question on an order in review", () => {
  async function inReviewWithQuestion(): Promise<string> {
    const id = await signed();
    reports.push("QUESTION: Should archived items be exported too?");
    await shop.flow.followUp(id, "Add a header row");
    await shop.flow.idle();
    expect(shop.activity.linksFor(id).question).toBe("Should archived items be exported too?");
    return id;
  }

  it("leaves the inbox when the director sends another follow-up and the pull request is updated", async () => {
    const id = await inReviewWithQuestion();

    const sent = await shop.flow.followUp(id, "Forget the header row, sort the rows by name");
    await shop.flow.idle();

    expect(sent.ok).toBe(true);
    expect(shop.activity.recent(5).map((entry) => entry.text)).toContain(`pull request #${pullRequestOf(id)} updated`);
    expect(inboxOf(shop, shop.desks[0]!.project.id).map((item) => item.question)).toEqual([]);
  });

  it("is not run over by the automatic follow-up on a conflict", async () => {
    const id = await inReviewWithQuestion();
    const other = await signed({ title: "Something else", likelyFiles: ["docs/other.md"] });
    vcs.setPullRequestState(shop.repo, pullRequestOf(other), "merged");
    vcs.setConflicts(shop.repo, pullRequestOf(id), true);

    await shop.watcher.poll();
    await shop.flow.idle();

    expect(shop.activity.recent(50).filter((entry) => entry.text.startsWith("follow-up requested: Other work was merged"))).toEqual([]);
  });
});
