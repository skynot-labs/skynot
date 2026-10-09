import type { StoredEvent } from "./event";
import type { EventLog } from "./event-log";

export interface Projection {
  apply(event: StoredEvent): void;
}

export async function attachProjection(log: EventLog, projection: Projection): Promise<() => void> {
  let lastApplied = 0;
  let replaying = true;
  const buffered: StoredEvent[] = [];

  const applyOnce = (event: StoredEvent) => {
    if (event.sequence <= lastApplied) return;
    projection.apply(event);
    lastApplied = event.sequence;
  };

  const unsubscribe = log.subscribe((event) => {
    if (replaying) buffered.push(event);
    else applyOnce(event);
  });

  for (const event of await log.readAfter(0)) applyOnce(event);
  replaying = false;
  buffered.forEach(applyOnce);

  return unsubscribe;
}
