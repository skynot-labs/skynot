import { describe, expect, it } from "vitest";
import { fixedClock } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { BriefingChanges, BriefingService, withSignedChanges, type BriefingStore } from "../../src/projects";

const file: BriefingStore = { read: async (projectId) => (projectId === "blog" ? "from the file" : null) };

async function open(store = new InMemoryEventStore()) {
  const log = new EventLog(store, fixedClock(new Date("2026-10-12T12:00:00.000Z")));
  const changes = new BriefingChanges();
  await attachProjection(log, changes);
  return { service: new BriefingService(log, changes), changes, store, briefing: withSignedChanges(file, changes, 1000) };
}

describe("briefing changes", () => {
  it("leaves the file in force until the director signs, then replaces it, and keeps it after a restart", async () => {
    const { service, briefing, store } = await open();
    const proposed = await service.propose("blog", "  Marta reads only Spanish.  ", "the director said so");
    if (!proposed.ok) throw new Error(proposed.error.message);

    expect(await briefing.read("blog")).toBe("from the file");
    expect(proposed.value.text).toBe("Marta reads only Spanish.");

    await service.sign(proposed.value.id);
    expect(await briefing.read("blog")).toBe("Marta reads only Spanish.");

    const restarted = await open(store);
    expect(await restarted.briefing.read("blog")).toBe("Marta reads only Spanish.");
  });

  it("keeps the file when the director discards, and allows one proposal at a time per project", async () => {
    const { service, briefing, changes } = await open();
    const first = await service.propose("blog", "new text", "because");
    if (!first.ok) throw new Error("propose failed");

    expect(await service.propose("blog", "another", "because")).toMatchObject({ ok: false, error: { message: expect.stringContaining("already") } });
    expect(await service.propose("shop", "for the shop", "because")).toMatchObject({ ok: true });

    await service.discard(first.value.id);
    expect(await briefing.read("blog")).toBe("from the file");
    expect(changes.pendingFor("blog")).toEqual([]);
    expect(changes.pendingFor("shop")).toHaveLength(1);
  });

  it("changes only the project it was signed for, and cuts what is too long for the prompt", async () => {
    const { service, briefing } = await open();
    const long = await service.propose("shop", "x".repeat(1200), "because");
    if (!long.ok) throw new Error("propose failed");
    await service.sign(long.value.id);

    expect((await briefing.read("shop"))?.length).toBe(1000);
    expect(await briefing.read("blog")).toBe("from the file");
  });

  it("refuses an empty or oversized text, a settled change and an unknown one", async () => {
    const { service } = await open();
    const made = await service.propose("blog", "fine text", "because");
    if (!made.ok) throw new Error("propose failed");
    await service.sign(made.value.id);

    expect(await service.propose("blog", "  ", "because")).toMatchObject({ ok: false });
    expect(await service.propose("blog", "x".repeat(1501), "because")).toMatchObject({ ok: false });
    expect(await service.sign(made.value.id)).toMatchObject({ ok: false, error: { kind: "invalid" } });
    expect(await service.sign("brf_missing")).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });
});
