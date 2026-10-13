import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PendingEvent, StoredEvent } from "./event";
import type { EventStore } from "./event-store";

export class JsonlEventStore implements EventStore {
  private loaded: StoredEvent[] | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  append(pending: readonly PendingEvent[]): Promise<StoredEvent[]> {
    return this.serialize(async () => {
      const events = await this.load();
      const stored = pending.map((event, index) => ({ ...event, sequence: events.length + index + 1 }));
      if (stored.length === 0) return stored;

      await mkdir(path.dirname(this.filePath), { recursive: true });
      try {
        await appendFile(this.filePath, stored.map((event) => `${JSON.stringify(event)}\n`).join(""));
      } catch (error) {
        // part of it may be on disk: the next call reads the file again and repairs its tail
        this.loaded = null;
        throw error;
      }
      events.push(...stored);
      return stored;
    });
  }

  readAfter(sequence: number): Promise<StoredEvent[]> {
    return this.serialize(async () => (await this.load()).filter((event) => event.sequence > sequence));
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async load(): Promise<StoredEvent[]> {
    if (this.loaded) return this.loaded;

    const raw = await this.readLines();
    // a complete last line without its newline would be glued to the next event appended
    const unterminated = raw.length > 0 && raw.at(-1) !== "";
    const lines = raw.filter((line) => line.length > 0);
    const events: StoredEvent[] = [];
    let truncatedTail = false;

    lines.forEach((line, index) => {
      try {
        events.push(JSON.parse(line) as StoredEvent);
      } catch {
        if (index < lines.length - 1) throw new Error(`Corrupt event log ${this.filePath}: line ${index + 1} is not valid JSON`);
        truncatedTail = true;
      }
    });

    if (truncatedTail || unterminated) {
      await writeFile(this.filePath, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    }
    this.loaded = events;
    return events;
  }

  private async readLines(): Promise<string[]> {
    try {
      return (await readFile(this.filePath, "utf8")).split("\n");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
