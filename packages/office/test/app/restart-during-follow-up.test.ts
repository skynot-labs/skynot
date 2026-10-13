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
let shops: Shop[];

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-restart-"));
  shops = [];
});

afterEach(async () => {
  shops.forEach((shop) => shop.stop());
  await rm(dataDir, { recursive: true, force: true });
});

async function openShop(vcs: FakeVcs, developer: FakeEngine): Promise<Shop> {
  const shop = await createShop({ policy: examplePolicy(), dataDir, team, engines: { claude: createMockManager(), codex: developer }, vcs, workspace: new FakeWorkspace() });
  shops.push(shop);
  return shop;
}

describe("a restart while a worker is on a follow-up", () => {
  it("tells the director the follow-up was dropped, as it does for an order on the bench", async () => {
    const vcs = new FakeVcs();
    let calls = 0;
    let started!: () => void;
    const working = new Promise<void>((resolve) => (started = resolve));
    const first = await openShop(
      vcs,
      new FakeEngine(() => {
        if (++calls === 1) return { text: "evidence: the new test passes" };
        started();
        return new Promise(() => undefined);
      }),
    );
    const proposed = await first.orderService.propose(validSpec());
    if (!proposed.ok) throw new Error(proposed.error.message);
    const id = proposed.value.id;
    await first.orderService.sign(id);
    await first.flow.idle();
    await first.flow.followUp(id, "Add a header row to the file");
    await working;
    first.stop();

    const restarted = await openShop(vcs, new FakeEngine());
    await restarted.manager.idle();

    expect(restarted.flow.working(id)).toBe(false);
    expect(restarted.activity.recent(50).map((entry) => entry.text)).not.toContain(`pull request #${restarted.orders.get(id)!.pullRequest} updated`);
    // nothing on the card or in the chat says the instruction never reached the pull request
    expect(restarted.activity.linksFor(id).blocked).toBe("the shop restarted while this order was being worked");
  });

  it("leaves alone an order whose follow-up reached the pull request, and one whose conflict the watcher takes up again", async () => {
    const vcs = new FakeVcs();
    let hang = false;
    const first = await openShop(vcs, new FakeEngine(() => (hang ? new Promise(() => undefined) : { text: "evidence: the new test passes" })));
    const sign = async (title: string, file: string) => {
      const proposed = await first.orderService.propose(validSpec({ title, likelyFiles: [file] }));
      if (!proposed.ok) throw new Error(proposed.error.message);
      await first.orderService.sign(proposed.value.id);
      await first.flow.idle();
      return proposed.value.id;
    };
    const finished = await sign("Finished its follow-up", "src/a.ts");
    const conflicting = await sign("Conflicts with the base", "src/b.ts");
    const merged = await sign("Merged meanwhile", "src/c.ts");
    await first.flow.followUp(finished, "Add a header row to the file");
    await first.flow.idle();

    hang = true;
    vcs.setPullRequestState(first.repo, first.orders.get(merged)!.pullRequest!, "merged");
    vcs.setConflicts(first.repo, first.orders.get(conflicting)!.pullRequest!, true);
    await first.watcher.poll();
    expect(first.flow.working(conflicting)).toBe(true);
    first.stop();

    const restarted = await openShop(vcs, new FakeEngine());
    await restarted.manager.idle();

    expect([finished, conflicting].map((id) => restarted.activity.linksFor(id).blocked)).toEqual([null, null]);
  });
});
