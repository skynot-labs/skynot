import {
  studioPreferencesSchema,
  normalizeStudioPreferences,
  defaultStudioPreferences,
  type StudioPreferences,
} from "../studio/model";
export const studioStorageKey = "skynot-studios-v1";
export type StudioAppearance = Record<string, StudioPreferences>;
export function readStudioAppearance(): StudioAppearance {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(studioStorageKey) ?? "{}",
    );
    if (!stored || typeof stored !== "object" || Array.isArray(stored))
      return {};
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
export function writeStudioAppearance(value: StudioAppearance) {
  const validated = Object.fromEntries(
    Object.entries(value).map(([id, settings]) => [
      id,
      studioPreferencesSchema.parse(settings),
    ]),
  );
  localStorage.setItem(studioStorageKey, JSON.stringify(validated));
}
export function projectStudio(
  value: StudioAppearance,
  id: string,
): StudioPreferences {
  return value[id] ?? defaultStudioPreferences;
}
