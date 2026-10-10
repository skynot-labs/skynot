import { isDeepStrictEqual } from "node:util";
import { err, ok, type Result } from "../kernel";
import type { EventLog, Projection, StoredEvent } from "../kernel/events";

export const PREFERENCE_KEY = /^(avatar|studio)\/[a-z][a-z0-9-]{1,39}(\/[a-z][a-z0-9_-]{0,39})?$/;
export const MAX_PREFERENCE_BYTES = 2048;
export const MAX_PREFERENCES = 200;

export type PreferenceValue = Record<string, unknown>;

export type PreferenceEvent = { type: "console.preference_set"; payload: { key: string; value: PreferenceValue | null } };

export interface PreferenceError {
  readonly kind: "too_large" | "too_many";
  readonly message: string;
}

// How the director arranged the console; the shop stores each value without reading it.
export class PreferencesProjection implements Projection {
  private readonly values = new Map<string, PreferenceValue>();

  apply(event: StoredEvent): void {
    if (event.type !== "console.preference_set") return;
    const { key, value } = event.payload as PreferenceEvent["payload"];
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
  }

  all(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }

  get(key: string): PreferenceValue | null {
    return this.values.get(key) ?? null;
  }

  get size(): number {
    return this.values.size;
  }
}

export async function setPreference(log: EventLog, preferences: PreferencesProjection, key: string, value: PreferenceValue | null): Promise<Result<null, PreferenceError>> {
  const stored = preferences.get(key);
  if (isDeepStrictEqual(stored, value)) return ok(null);
  if (value !== null) {
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_PREFERENCE_BYTES) return err({ kind: "too_large", message: `a preference holds at most ${MAX_PREFERENCE_BYTES} bytes` });
    if (stored === null && preferences.size >= MAX_PREFERENCES) return err({ kind: "too_many", message: `the console keeps at most ${MAX_PREFERENCES} preferences: remove one first` });
  }
  const event: PreferenceEvent = { type: "console.preference_set", payload: { key, value } };
  await log.record([event]);
  return ok(null);
}
