import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newId } from "../../src/kernel";
import { InMemoryEventStore, JsonlEventStore, type EventStore, type PendingEvent } from "../../src/kernel/events";

const pending = (type: string, payload: unknown = {}): PendingEvent => ({
  id: newId("evt"),
  occurredAt: "2026-10-09T12:00:00.000Z",
  type,
  payload,
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "skynot-events-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const stores: Array<[string, () => EventStore]> = [
  ["in-memory", () => new InMemoryEventStore()],
  ["jsonl", () => new JsonlEventStore(path.join(dir, "events.jsonl"))],
];

describe.each(stores)("%s event store", (_name, create) => {
  it("assigns increasing sequences starting at 1", async () => {
    const store = create();
    const first = await store.append([pending("a"), pending("b")]);
    const second = await store.append([pending("c")]);
    expect([...first, ...second].map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("reads only the events after a cursor", async () => {
    const store = create();
    await store.append([pending("a"), pending("b"), pending("c")]);
    expect((await store.readAfter(1)).map((event) => event.type)).toEqual(["b", "c"]);
    expect(await store.readAfter(3)).toEqual([]);
  });

  it("keeps order and unique sequences under concurrent appends", async () => {
    const store = create();
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.append([pending(`e${index}`)])));
    const all = await store.readAfter(0);
    expect(all.map((event) => event.sequence)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(all.map((event) => event.type)).toEqual(Array.from({ length: 20 }, (_, index) => `e${index}`));
  });
});

describe("jsonl event store", () => {
  it("persists across instances and continues the sequence", async () => {
    const file = path.join(dir, "nested", "events.jsonl");
    await new JsonlEventStore(file).append([pending("a", { n: 1 })]);

    const reopened = new JsonlEventStore(file);
    expect(await reopened.readAfter(0)).toMatchObject([{ sequence: 1, type: "a", payload: { n: 1 } }]);
    const [next] = await reopened.append([pending("b")]);
    expect(next?.sequence).toBe(2);
  });

  it("drops a truncated last line and keeps the file well formed", async () => {
    const file = path.join(dir, "events.jsonl");
    await new JsonlEventStore(file).append([pending("a")]);
    await appendFile(file, '{"sequence":2,"type":"half');

    const reopened = new JsonlEventStore(file);
    expect((await reopened.readAfter(0)).map((event) => event.type)).toEqual(["a"]);
    await reopened.append([pending("b")]);

    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).type)).toEqual(["a", "b"]);
  });

  it("refuses a log corrupted before its last line", async () => {
    const file = path.join(dir, "events.jsonl");
    await writeFile(file, `not json\n${JSON.stringify({ ...pending("a"), sequence: 1 })}\n`);
    await expect(new JsonlEventStore(file).readAfter(0)).rejects.toThrow(/line 1/);
  });
});
