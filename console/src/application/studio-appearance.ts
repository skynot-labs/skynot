import type { Command } from "../contracts";
import {
  studioPreferencesSchema,
  normalizeStudioPreferences,
  defaultStudioPreferences,
  type StudioPreferences,
} from "../studio/model";
export const studioStorageKey = "skynot-studios-v1";
export type StudioAppearance = Record<string, StudioPreferences>;

// Mirrors PREFERENCE_KEY in src/app/preferences.ts, which the browser cannot import.
const STUDIO_KEY = /^studio\/[a-z][a-z0-9-]{1,39}$/;

export function studioAppearanceFrom(
  preferences: Record<string, unknown>,
): StudioAppearance {
  return Object.fromEntries(
    Object.entries(preferences)
      .filter(([key, value]) => STUDIO_KEY.test(key) && isObject(value))
      .map(([key, value]) => [
        key.slice("studio/".length),
        normalizeStudioPreferences(value),
      ]),
  );
}

export function studioPreference(
  projectId: string,
  value: StudioPreferences | null,
): Extract<Command, { name: "set-preference" }> | null {
  const key = `studio/${projectId}`;
  if (!STUDIO_KEY.test(key)) return null;
  return {
    name: "set-preference",
    payload: { key, value: value && studioPreferencesSchema.parse(value) },
  };
}

export function projectStudio(
  value: StudioAppearance,
  id: string,
): StudioPreferences {
  return value[id] ?? defaultStudioPreferences;
}

export function readLocalStudioAppearance(): StudioAppearance {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(studioStorageKey) ?? "{}",
    );
    if (!isObject(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).map(([id, value]) => [
        id,
        normalizeStudioPreferences(value),
      ]),
    );
  } catch {
    return {};
  }
}

export function forgetLocalStudioAppearance() {
  try {
    localStorage.removeItem(studioStorageKey);
  } catch {
    return;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
