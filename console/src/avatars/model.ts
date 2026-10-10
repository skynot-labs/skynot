import { z } from "zod";

export const avatarChoices = {
  style: [
    { value: "short", label: "Short" },
    { value: "wave", label: "Wavy" },
    { value: "long", label: "Long" },
    { value: "ponytail", label: "Ponytail" },
    { value: "buzz", label: "Buzz cut" },
    { value: "bald", label: "Bald" },
  ],
  outfit: [
    { value: "tee", label: "T-shirt" },
    { value: "shirt", label: "Shirt" },
    { value: "hoodie", label: "Hoodie" },
    { value: "sweater", label: "Sweater" },
    { value: "jacket", label: "Jacket" },
    { value: "happi", label: "Japanese happi" },
    { value: "striped", label: "Striped sailor top" },
    { value: "embroidered", label: "Embroidered shirt" },
    { value: "skeleton", label: "Skeleton costume" },
    { value: "festive", label: "Christmas sweater" },
  ],
  eyewear: [
    { value: "none", label: "No glasses" },
    { value: "optical", label: "Optical" },
    { value: "round", label: "Round optical" },
    { value: "sun", label: "Sunglasses" },
  ],
  headwear: [
    { value: "none", label: "No hat" },
    { value: "cap", label: "Cap" },
    { value: "beanie", label: "Beanie" },
    { value: "flowers", label: "Flower crown" },
    { value: "santa", label: "Santa hat" },
    { value: "witch", label: "Witch hat" },
    { value: "kabuto", label: "Samurai kabuto" },
    { value: "straw", label: "Straw hat" },
  ],
  audio: [
    { value: "none", label: "No audio" },
    { value: "headphones", label: "Headphones" },
    { value: "earbuds", label: "Earbuds" },
  ],
  neckwear: [
    { value: "none", label: "Nothing" },
    { value: "scarf", label: "Scarf" },
    { value: "tie", label: "Tie" },
    { value: "necklace", label: "Necklace" },
  ],
  facePaint: [
    { value: "none", label: "No face paint" },
    { value: "calavera", label: "Colorful calavera" },
  ],
  facialHair: [
    { value: "none", label: "Clean shaven" },
    { value: "stubble", label: "Stubble" },
    { value: "beard", label: "Beard" },
    { value: "mustache", label: "Mustache" },
  ],
} as const;

export const avatarLimits = {
  height: { min: 0.8, max: 1.2, step: 0.05 },
  build: { min: 0.8, max: 1.5, step: 0.05 },
} as const;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const avatarSchema = z.object({
  skin: color,
  hair: color,
  shirt: color,
  style: z.enum(avatarChoices.style.map((option) => option.value)),
  height: z
    .number()
    .min(avatarLimits.height.min)
    .max(avatarLimits.height.max)
    .default(1),
  build: z
    .number()
    .min(avatarLimits.build.min)
    .max(avatarLimits.build.max)
    .default(1),
  outfit: z
    .enum(avatarChoices.outfit.map((option) => option.value))
    .default("tee"),
  pants: color.default("#474353"),
  shoes: color.default("#262632"),
  accent: color.default("#a5d7b8"),
  eyewear: z
    .enum(avatarChoices.eyewear.map((option) => option.value))
    .default("none"),
  headwear: z
    .enum(avatarChoices.headwear.map((option) => option.value))
    .default("none"),
  audio: z
    .enum(avatarChoices.audio.map((option) => option.value))
    .default("none"),
  neckwear: z
    .enum(avatarChoices.neckwear.map((option) => option.value))
    .default("none"),
  facePaint: z
    .enum(avatarChoices.facePaint.map((option) => option.value))
    .default("none"),
  facialHair: z
    .enum(avatarChoices.facialHair.map((option) => option.value))
    .default("none"),
});

export type Avatar = z.input<typeof avatarSchema>;
export type ResolvedAvatar = z.output<typeof avatarSchema>;
export function resolveAvatar(value: Avatar): ResolvedAvatar {
  return avatarSchema.parse(value);
}
