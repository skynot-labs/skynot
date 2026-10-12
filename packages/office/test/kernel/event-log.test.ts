import { describe, expect, it } from "vitest";
import { fixedClock } from "../../src/kernel";
import {
  attachProjection,
  EventLog,
  InMemoryEventStore,
  type Projection,
  type StoredEvent,
} from "../../src/kernel/events";

const at = new Date("2026-10-09T12:00:00.000Z");

function createLog(reportError: (error: unknown, event: StoredEvent) => void = () => {}) {
  return new EventLog(new InMemoryEventStore(), fixedClock(at), reportError);
}

describe("event log", () => {
  it("stamps events with an id and the clock time, then delivers them in order", async () => {
    const log = createLog();
    const seen: StoredEvent[] = [];
    log.subscribe((event) => {
      seen.push(event);
    });

    await log.record([{ type: "a", payload: 1 }, { type: "b", payload: 2 }]);

    expect(seen.map((event) => [event.sequence, event.type, event.occurredAt])).toEqual([
      [1, "a", at.toISOString()],
      [2, "b", at.toISOString()],
    ]);
    expect(seen[0]?.id).toMatch(/^evt_/);
  });

  it("delivers events from concurrent records in sequence order", async () => {
    const log = createLog();
    const seen: number[] = [];
    log.subscribe(async (event) => {
      await new Promise((resolve) => setTimeout(resolve, event.sequence === 1 ? 20 : 0));
      seen.push(event.sequence);
    });

    await Promise.all([log.record([{ type: "a", payload: null }]), log.record([{ type: "b", payload: null }])]);

    expect(seen).toEqual([1, 2]);
  });

  it("keeps delivering when a handler fails, and reports the failure", async () => {
    const reported: string[] = [];
    const log = createLog((error) => reported.push((error as Error).message));
    const delivered: string[] = [];
    log.subscribe(() => {
      throw new Error("boom");
    });
    log.subscribe((event) => {
      delivered.push(event.type);
    });

    await log.record([{ type: "a", payload: null }]);

    expect(delivered).toEqual(["a"]);
    expect(reported).toEqual(["boom"]);
  });

  it("stops delivering after unsubscribe", async () => {
    const log = createLog();
    const seen: string[] = [];
    const unsubscribe = log.subscribe((event) => {
      seen.push(event.type);
    });

    await log.record([{ type: "a", payload: null }]);
    unsubscribe();
    await log.record([{ type: "b", payload: null }]);

    expect(seen).toEqual(["a"]);
  });
});

describe("attachProjection", () => {
  class TypeCounter implements Projection {
    readonly types: string[] = [];
    apply(event: StoredEvent) {
      this.types.push(event.type);
    }
  }

  it("replays history and then follows new events, each exactly once", async () => {
    const log = createLog();
    await log.record([{ type: "old-1", payload: null }, { type: "old-2", payload: null }]);

    const projection = new TypeCounter();
    await attachProjection(log, projection);
    await log.record([{ type: "new-1", payload: null }]);

    expect(projection.types).toEqual(["old-1", "old-2", "new-1"]);
  });

  it("stops following after being detached", async () => {
    const log = createLog();
    const projection = new TypeCounter();
    const detach = await attachProjection(log, projection);

    await log.record([{ type: "a", payload: null }]);
    detach();
    await log.record([{ type: "b", payload: null }]);

    expect(projection.types).toEqual(["a"]);
  });
});
