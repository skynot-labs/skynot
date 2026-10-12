import {
  resolveAvatar,
  type Avatar,
  type ResolvedAvatar,
} from "../avatars/model";
import type { StudioPreferences } from "./model";
type WardrobePatch = Pick<
  ResolvedAvatar,
  | "outfit"
  | "shirt"
  | "pants"
  | "accent"
  | "headwear"
  | "neckwear"
  | "facePaint"
>;
export const wardrobeLooks = {
  kyoto: {
    name: "Happi & kabuto",
    patch: {
      facePaint: "none",
      outfit: "happi",
      shirt: "#3769a2",
      pants: "#313c58",
      accent: "#efb84d",
      headwear: "kabuto",
      neckwear: "none",
    },
  },
  coast: {
    name: "Sailor",
    patch: {
      facePaint: "none",
      outfit: "striped",
      shirt: "#f4f5de",
      pants: "#377fa8",
      accent: "#d56552",
      headwear: "straw",
      neckwear: "scarf",
    },
  },
  cdmx: {
    name: "Mexican patio",
    patch: {
      facePaint: "none",
      outfit: "embroidered",
      shirt: "#f7e8c8",
      pants: "#2d7e82",
      accent: "#e75399",
      headwear: "none",
      neckwear: "none",
    },
  },
  everyday: {
    name: "Workshop",
    patch: {
      facePaint: "none",
      outfit: "shirt",
      shirt: "#b5a0ed",
      pants: "#474353",
      accent: "#a5d7b8",
      headwear: "none",
      neckwear: "none",
    },
  },
  spring: {
    name: "Spring",
    patch: {
      facePaint: "none",
      outfit: "shirt",
      shirt: "#e58caf",
      pants: "#72877e",
      accent: "#e0c38c",
      headwear: "flowers",
      neckwear: "necklace",
    },
  },
  summer: {
    name: "Summer",
    patch: {
      facePaint: "none",
      outfit: "striped",
      shirt: "#eef4df",
      pants: "#7bada5",
      accent: "#326fb1",
      headwear: "straw",
      neckwear: "none",
    },
  },
  autumn: {
    name: "Autumn",
    patch: {
      facePaint: "none",
      outfit: "jacket",
      shirt: "#c5723f",
      pants: "#525d67",
      accent: "#d3ab7a",
      headwear: "none",
      neckwear: "scarf",
    },
  },
  winter: {
    name: "Winter",
    patch: {
      facePaint: "none",
      outfit: "sweater",
      shirt: "#5984c1",
      pants: "#485363",
      accent: "#d8c8a2",
      headwear: "beanie",
      neckwear: "scarf",
    },
  },
  halloween: {
    name: "Halloween",
    patch: {
      facePaint: "none",
      outfit: "skeleton",
      shirt: "#343041",
      pants: "#3e394d",
      accent: "#dd75e3",
      headwear: "witch",
      neckwear: "none",
    },
  },
  christmas: {
    name: "Christmas",
    patch: {
      facePaint: "none",
      outfit: "festive",
      shirt: "#d34256",
      pants: "#46575b",
      accent: "#e74953",
      headwear: "santa",
      neckwear: "scarf",
    },
  },
  muertos: {
    name: "Cempasúchil",
    patch: {
      facePaint: "calavera",
      outfit: "embroidered",
      shirt: "#dd58a2",
      pants: "#534460",
      accent: "#ffa526",
      headwear: "flowers",
      neckwear: "necklace",
    },
  },
} satisfies Record<string, { name: string; patch: WardrobePatch }>;
export type WardrobeLookId = keyof typeof wardrobeLooks;
export function applyWardrobeLook(
  avatar: Avatar,
  id: WardrobeLookId,
  preserveAccessories = false,
) {
  const base = resolveAvatar(avatar),
    patch = wardrobeLooks[id].patch;
  return resolveAvatar({
    ...base,
    ...patch,
    headwear:
      preserveAccessories && base.headwear !== "none"
        ? base.headwear
        : patch.headwear,
    neckwear:
      preserveAccessories && base.neckwear !== "none"
        ? base.neckwear
        : patch.neckwear,
  });
}
export function ambientAvatar(avatar: Avatar, preferences: StudioPreferences) {
  if (preferences.wardrobe === "personal") return resolveAvatar(avatar);
  if (preferences.festival !== "none")
    return applyWardrobeLook(avatar, preferences.festival, true);
  if (preferences.place === "studio")
    return applyWardrobeLook(
      avatar,
      preferences.season === "neutral" ? "everyday" : preferences.season,
      true,
    );
  const regional = wardrobeLooks[preferences.place].patch;
  const base = resolveAvatar(avatar);
  return resolveAvatar({
    ...base,
    ...regional,
    ...(preferences.season === "neutral"
      ? {}
      : { accent: wardrobeLooks[preferences.season].patch.accent }),
    headwear: base.headwear !== "none" ? base.headwear : regional.headwear,
    neckwear:
      base.neckwear !== "none"
        ? base.neckwear
        : preferences.season === "winter" || preferences.season === "autumn"
          ? "scarf"
          : regional.neckwear,
  });
}
