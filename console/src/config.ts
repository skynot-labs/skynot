import tokens from "./design/tokens.json";
import type { Avatar } from "./contracts";
import { resolveAvatar } from "./avatars/model";

export const config = {
  appearanceStorageKey: "skynot-appearance-v1",
  palettes: {
    skin: ["#ecc3a0", "#e8af87", "#d69b73", "#b57e60", "#9b664e", "#694739"],
    hair: ["#3a293e", "#88513c", "#bc6b43", "#d1a663", "#e0d4c6", "#a489cb"],
    shirt: ["#b5a0ed", "#79b8a1", "#e4a36f", "#6a96d0", "#d37994", "#ded9c9"],
  },
  wardrobePalette: [
    "#b5a0ed",
    "#79b8a1",
    "#e4a36f",
    "#6a96d0",
    "#d37994",
    "#ded9c9",
    "#44475e",
    "#262632",
    "#f0e9df",
    "#94503e",
  ],
  accents: [
    tokens.color.mint,
    tokens.color.lavender,
    tokens.color.peach,
    tokens.color.blue,
  ],
};

const cycle = <T>(values: readonly T[], index: number) =>
  values[index % values.length]!;

export function defaultAvatar(index: number): Avatar {
  return resolveAvatar({
    skin: cycle(config.palettes.skin, index),
    hair: cycle(config.palettes.hair, index),
    shirt: cycle(config.palettes.shirt, index),
    style: cycle(["wave", "short", "long"] as const, index),
    audio: cycle(["none", "headphones", "none"] as const, index),
    eyewear: cycle(["none", "none", "optical"] as const, index),
  });
}
