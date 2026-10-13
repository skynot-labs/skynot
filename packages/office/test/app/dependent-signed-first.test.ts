import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { blockersOf, evolve, propose, type OrderStatus, type WorkOrder, type WorkOrderSpec } from "../../src/orders";
import type { Team } from "../../src/team";
import { examplePolicy } from "../governance/fixtures";
import { validSpec } from "../orders/fixtures";

function order(number: number, status: OrderStatus, spec: Partial<WorkOrderSpec>, signedAt: string): WorkOrder {
  const id = `WO-${String(number).padStart(4, "0")}` as WorkOrder["id"];
  const proposed = evolve(null, propose(id, validSpec(spec)), "2026-10-10T09:00:00.000Z")!;
  return { ...proposed, status, signedAt };
}

describe("an order that declares a dependency and shares its files, signed before that dependency", () => {
  it("does not leave the two orders waiting for each other (domain)", () => {
    const dependency = order(1, "signed", { likelyFiles: ["src/items/"] }, "2026-10-10T11:00:00.000Z");
    const dependent = order(2, "signed", { likelyFiles: ["src/items/export.ts"], dependsOn: ["WO-0001"] }, "2026-10-10T10:00:00.000Z");
    const all = [dependency, dependent];

    expect(blockersOf(dependent, all)).toEqual(["WO-0001"]);
    // the dependency must be free to start, or nothing ever does
    expect(blockersOf(dependency, all)).toEqual([]);
  });

  it("keeps waiting for the dependent order once that one was started anyway, and through a chain of dependencies", () => {
    const started = order(2, "on_bench", { likelyFiles: ["src/items/export.ts"], dependsOn: ["WO-0001"] }, "2026-10-10T10:00:00.000Z");
    const dependency = order(1, "signed", { likelyFiles: ["src/items/"] }, "2026-10-10T11:00:00.000Z");
    expect(blockersOf(dependency, [dependency, started])).toEqual(["WO-0002"]);

    const first = order(3, "signed", { likelyFiles: ["src/a.ts"], dependsOn: ["WO-0004"] }, "2026-10-10T10:00:00.000Z");
    const middle = order(4, "signed", { likelyFiles: ["src/b.ts"], dependsOn: ["WO-0005"] }, "2026-10-10T11:00:00.000Z");
    const last = order(5, "signed", { likelyFiles: ["src/a.ts"] }, "2026-10-10T12:00:00.000Z");
    expect(blockersOf(last, [first, middle, last])).toEqual([]);
  });

  describe("through the shop", () => {
    let dataDir: string;
    let shop: Shop;
    const team: Team = { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };

    beforeEach(async () => {
      dataDir = await mkdtemp(path.join(tmpdir(), "skynot-bughunt-"));
      shop = await createShop({ policy: examplePolicy(), dataDir, team, engines: { claude: createMockManager(), codex: createMockDeveloper() }, vcs: new FakeVcs(), workspace: new FakeWorkspace() });
    });

    afterEach(async () => {
      shop.stop();
      await rm(dataDir, { recursive: true, force: true });
    });

    it("starts the dependency once both are signed", async () => {
      const first = await shop.orderService.propose(validSpec({ title: "Lay the ground" }));
      if (!first.ok) throw new Error("could not propose the first order");
      const second = await shop.orderService.propose(validSpec({ title: "Build on it", dependsOn: [first.value.id] }));
      if (!second.ok) throw new Error("could not propose the second order");

      // the director signs the dependent order first, then the one it depends on
      await shop.orderService.sign(second.value.id);
      await shop.flow.idle();
      await new Promise((resolve) => setTimeout(resolve, 5));
      await shop.orderService.sign(first.value.id);
      await shop.flow.idle();

      const seen = [first.value.id, second.value.id].map((id) => ({ id, status: shop.orders.get(id)?.status, waitingOn: shop.activity.linksFor(id).waitingOn }));
      expect(seen).toMatchObject([
        { id: first.value.id, status: "in_review", waitingOn: [] },
        { id: second.value.id, status: "signed", waitingOn: [first.value.id] },
      ]);
    });
  });
});
