import { z } from "zod";
import {
  places,
  decorSlots,
  seasons,
  festivals,
  layoutChoices,
  type DecorId,
  type ScenePalette,
} from "./catalog";
const keys = <T extends Record<string, unknown>>(value: T) =>
  Object.keys(value) as [keyof T & string, ...(keyof T & string)[]];
export const studioPreferencesSchema = z.object({
  place: z.enum(keys(places)).default("studio"),
  season: z.enum(keys(seasons)).default("neutral"),
  festival: z.enum(keys(festivals)).default("none"),
  layout: z.enum(keys(layoutChoices)).default("zones"),
  wardrobe: z.enum(["personal", "ambient"]).default("personal"),
});
export type StudioPreferences = z.output<typeof studioPreferencesSchema>;
export const defaultStudioPreferences = studioPreferencesSchema.parse({});
// Recover unknown catalog IDs independently. One future option must not reset
// the other fields or preferences belonging to another project.
export function normalizeStudioPreferences(input: unknown): StudioPreferences {
  const result = { ...defaultStudioPreferences };
  const source =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  for (const key of Object.keys(result) as (keyof StudioPreferences)[]) {
    const parsed = studioPreferencesSchema.shape[key].safeParse(source[key]);
    if (parsed.success) Object.assign(result, { [key]: parsed.data });
  }
  return result;
}
export function resolveSceneTheme(preferences: StudioPreferences) {
  const place = places[preferences.place],
    season = seasons[preferences.season],
    festival = festivals[preferences.festival];
  const combined = [
    ...place.decor,
    ...season.decor,
    ...festival.decor,
  ] as DecorId[];
  const occupied = new Map<string, DecorId>();
  for (const id of combined) {
    const slot = decorSlots[id];
    if (slot) occupied.set(slot, id);
  }
  return {
    place,
    season,
    festival,
    palette: {
      ...place.palette,
      ...season.palette,
      ...festival.palette,
    } as ScenePalette,
    decor: [...new Set(combined)].filter(
      (id) => !decorSlots[id] || occupied.get(decorSlots[id]!) === id,
    ),
    preferences,
  };
}
export function studioSummary(value: StudioPreferences) {
  return `${places[value.place].name} · ${value.festival === "none" ? seasons[value.season].name : festivals[value.festival].name}`;
}
