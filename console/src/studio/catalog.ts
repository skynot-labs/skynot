export type ScenePalette = {
  backdrop: string;
  floor: string;
  floorAlt: string;
  wallLeft: string;
  wallRight: string;
  trim: string;
  wood: string;
  sky: string;
  horizon: string;
  foliage: string;
  foliageLight: string;
  rug: string;
};
export type DecorId =
  | "lanterns"
  | "bonsai"
  | "parasol"
  | "cactus"
  | "blossoms"
  | "leaves"
  | "snow"
  | "pumpkins"
  | "tree"
  | "garland"
  | "marigolds"
  | "summerLounge"
  | "snowman"
  | "haunted"
  | "ofrenda";
// Later layers win when props occupy the same physical space.
export const decorSlots: Partial<Record<DecorId, "counter">> = {
  parasol: "counter",
  tree: "counter",
  pumpkins: "counter",
  ofrenda: "counter",
};
type Place = {
  name: string;
  subtitle: string;
  icon: string;
  view: "city" | "mountains" | "sea" | "patio";
  material: "wood" | "tatami" | "tile";
  palette: ScenePalette;
  decor: DecorId[];
};
const base: ScenePalette = {
  backdrop: "#252630",
  floor: "#b3a697",
  floorAlt: "#c0b3a4",
  wallLeft: "#d5cebd",
  wallRight: "#c3c0bc",
  trim: "#e6ddd0",
  wood: "#d0aa89",
  sky: "#c9d9d5",
  horizon: "#8a9ca8",
  foliage: "#79a785",
  foliageLight: "#9ec191",
  rug: "#9ebba9",
};
export const places = {
  studio: {
    name: "Original studio",
    subtitle: "Wood, plants and the city",
    icon: "office",
    view: "city",
    material: "wood",
    palette: base,
    decor: [],
  },
  kyoto: {
    name: "Kyoto",
    subtitle: "Torii, samurai and anime",
    icon: "flower",
    view: "mountains",
    material: "tatami",
    palette: {
      ...base,
      backdrop: "#283835",
      floor: "#a39877",
      floorAlt: "#b0a689",
      wallLeft: "#e0d8bc",
      wallRight: "#cecbb2",
      trim: "#756957",
      wood: "#aa826b",
      sky: "#d7ded1",
      horizon: "#88a29c",
      foliage: "#9cafa0",
      foliageLight: "#bbc4a1",
      rug: "#a9bda1",
    },
    decor: ["lanterns", "bonsai"],
  },
  coast: {
    name: "Mediterranean coast",
    subtitle: "Arches, tiles and sailboats",
    icon: "sun",
    view: "sea",
    material: "tile",
    palette: {
      ...base,
      backdrop: "#243b47",
      floor: "#d1bfa5",
      floorAlt: "#e0cdb3",
      wallLeft: "#ede5d5",
      wallRight: "#d7e1df",
      trim: "#eee9dd",
      wood: "#b4a18b",
      sky: "#d6e8ed",
      horizon: "#80b4c4",
      foliage: "#839c7c",
      foliageLight: "#b0bea0",
      rug: "#acd0cc",
    },
    decor: ["parasol"],
  },
  cdmx: {
    name: "Patio in CDMX",
    subtitle: "Lucha libre, axolotl and color",
    icon: "plant",
    view: "patio",
    material: "tile",
    palette: {
      ...base,
      backdrop: "#34303a",
      floor: "#b8917f",
      floorAlt: "#caab92",
      wallLeft: "#f0b550",
      wallRight: "#e483aa",
      trim: "#eddac1",
      wood: "#ab826a",
      sky: "#e7d7c2",
      horizon: "#b59683",
      foliage: "#5e9780",
      foliageLight: "#91b393",
      rug: "#bdc6a2",
    },
    decor: ["cactus", "garland"],
  },
} satisfies Record<string, Place>;
export type PlaceId = keyof typeof places;
export const seasons = {
  neutral: { name: "Year-round", icon: "sun", palette: {}, decor: [] },
  spring: {
    name: "Spring",
    icon: "flower",
    palette: { foliage: "#c891a1", foliageLight: "#e0b4bc" },
    decor: ["blossoms"],
  },
  summer: {
    name: "Summer",
    icon: "sun",
    palette: { sky: "#ffdf99", foliage: "#76a37b", foliageLight: "#a6bf86" },
    decor: ["summerLounge"],
  },
  autumn: {
    name: "Autumn",
    icon: "leaf",
    palette: { sky: "#ddc9b0", foliage: "#ad8064", foliageLight: "#d1a06e" },
    decor: ["leaves"],
  },
  winter: {
    name: "Winter",
    icon: "snow",
    palette: { sky: "#d9e4e9", foliage: "#839e9b", foliageLight: "#bad0cd" },
    decor: ["snow", "snowman"],
  },
} satisfies Record<
  string,
  {
    name: string;
    icon: string;
    palette: Partial<ScenePalette>;
    decor: DecorId[];
  }
>;
export type SeasonId = keyof typeof seasons;
export const festivals = {
  none: { name: "No festival", icon: "star", palette: {}, decor: [] },
  halloween: {
    name: "Halloween",
    icon: "moon",
    palette: { backdrop: "#38304c", rug: "#ae8dbb" },
    decor: ["pumpkins", "garland", "haunted"],
  },
  christmas: {
    name: "Christmas",
    icon: "star",
    palette: { backdrop: "#20373b" },
    decor: ["tree", "garland"],
  },
  muertos: {
    name: "Día de Muertos",
    icon: "flower",
    palette: { backdrop: "#403047" },
    decor: ["marigolds", "garland", "ofrenda"],
  },
} satisfies Record<
  string,
  {
    name: string;
    icon: string;
    palette: Partial<ScenePalette>;
    decor: DecorId[];
  }
>;
export type FestivalId = keyof typeof festivals;
export const layoutChoices = {
  zones: {
    name: "By zones",
    description: "Management, design and development apart",
  },
  open: {
    name: "Open studio",
    description: "One shared space, no partitions",
  },
  pods: {
    name: "Team islands",
    description: "Design on the left; direction on the right",
  },
};
export type LayoutId = keyof typeof layoutChoices;
export const studioPresets = [
  {
    id: "spring-kyoto",
    name: "Spring garden",
    description: "Kyoto · blossoms · open studio",
    icon: "flower",
    settings: {
      place: "kyoto",
      season: "spring",
      festival: "none",
      layout: "open",
      wardrobe: "ambient",
    },
  },
  {
    id: "summer-coast",
    name: "A summer by the sea",
    description: "Coast · warm light · team islands",
    icon: "sun",
    settings: {
      place: "coast",
      season: "summer",
      festival: "none",
      layout: "pods",
      wardrobe: "ambient",
    },
  },
  {
    id: "cdmx-muertos",
    name: "A patio in November",
    description: "CDMX · cempasúchil · by zones",
    icon: "flower",
    settings: {
      place: "cdmx",
      season: "autumn",
      festival: "muertos",
      layout: "zones",
      wardrobe: "ambient",
    },
  },
] as const;
