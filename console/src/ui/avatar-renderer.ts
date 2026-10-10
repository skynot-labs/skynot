import type { Avatar, ResolvedAvatar } from "../avatars/model";
import { resolveAvatar } from "../avatars/model";

const shade = (hex: string, amount: number) =>
  "#" +
  hex
    .slice(1)
    .match(/../g)!
    .map((part) =>
      Math.max(0, Math.min(255, parseInt(part, 16) + amount))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

export function avatarBounds(look: Avatar) {
  const { height = 1, build = 1, headwear = "none" } = look;
  const headroom =
    headwear === "witch" || headwear === "santa" || headwear === "kabuto"
      ? 4
      : headwear === "none"
        ? 0
        : 2;
  return {
    left: Math.min(headwear === "straw" ? -3 : 0, 8 - 7 * build),
    right: Math.max(headwear === "straw" ? 19 : 16, 8 + 7 * build),
    top: -(height - 1) * 18 - headroom,
    bottom: 27,
  };
}

/** Feet stay anchored to the same floor/seat; only the body changes width.
 * A shared renderer keeps the editor, roster and office characters consistent. */
export function drawPixelAvatar(
  ctx: CanvasRenderingContext2D,
  input: Avatar,
  x: number,
  y: number,
  scale = 3,
  seated = false,
  frame = 0,
) {
  const look: ResolvedAvatar = resolveAvatar(input);
  const {
    skin,
    hair,
    shirt,
    style,
    outfit,
    pants,
    shoes,
    accent,
    build,
    height,
  } = look;
  const dark = "#353044";
  const stretch = (height - 1) * 18;
  const vertical = (b: number) =>
    b <= 12
      ? b - stretch
      : b <= 21
        ? 12 - stretch + (b - 12) * (1 + (stretch * 0.55) / 9)
        : 21 - stretch * 0.45 + (b - 21) * (1 + (stretch * 0.45) / 6);
  const px = (a: number, b: number, w: number, h: number, c: string) => {
    const horizontal = (n: number) => (b >= 12 ? 8 + (n - 8) * build : n);
    const left = Math.round(x + horizontal(a) * scale),
      top = Math.round(y + vertical(b) * scale);
    ctx.fillStyle = c;
    ctx.fillRect(
      left,
      top,
      Math.max(1, Math.round(x + horizontal(a + w) * scale) - left),
      Math.max(1, Math.round(y + vertical(b + h) * scale) - top),
    );
  };
  if (style === "long") {
    px(3, 2, 10, 13, hair);
    px(2, 5, 12, 8, hair);
  }
  if (style === "ponytail") {
    px(12, 3, 3, 4, hair);
    px(13, 6, 3, 7, hair);
    px(13, 6, 2, 1, accent);
  }
  px(6, 10, 4, 3, shade(skin, -18));
  px(3, 12, 10, 8, shirt);
  px(4, 12, 2, 8, shade(shirt, 16));
  px(11, 13, 2, 7, shade(shirt, -22));
  const sleeved = outfit !== "tee";
  px(2, 13, 2, 6, sleeved ? shirt : skin);
  px(12, 13, 2, 6, sleeved ? shade(shirt, -14) : shade(skin, -14));
  if (outfit === "tee") {
    px(2, 12, 2, 3, shirt);
    px(12, 12, 2, 3, shade(shirt, -14));
  }
  px(2, 18, 2, 2, skin);
  px(12, 18, 2, 2, shade(skin, -14));
  if (outfit === "shirt") {
    px(6, 12, 2, 2, shade(shirt, 40));
    px(9, 12, 2, 2, shade(shirt, 40));
    px(8, 14, 1, 6, shade(shirt, -24));
    for (let row = 15; row < 20; row += 2) px(8, row, 1, 1, "#eee7d9");
  }
  if (outfit === "hoodie") {
    px(4, 11, 3, 3, shade(shirt, -25));
    px(10, 11, 3, 3, shade(shirt, -25));
    px(6, 14, 1, 3, "#f0e9df");
    px(10, 14, 1, 3, "#f0e9df");
    px(6, 18, 5, 2, shade(shirt, -22));
    px(3, 20, 10, 1, shade(shirt, -30));
  }
  if (outfit === "sweater") {
    px(6, 12, 5, 1, shade(shirt, -25));
    px(3, 19, 10, 2, shade(shirt, -20));
    px(2, 17, 2, 1, accent);
    px(12, 17, 2, 1, accent);
  }
  if (outfit === "jacket") {
    px(7, 12, 3, 8, "#efe8dd");
    px(5, 12, 2, 3, shade(shirt, -25));
    px(10, 12, 2, 3, shade(shirt, -25));
    px(5, 16, 2, 1, accent);
    px(11, 16, 1, 1, accent);
  }
  if (outfit === "happi") {
    px(2, 13, 2, 5, shade(shirt, -10));
    px(12, 13, 2, 5, shade(shirt, -10));
    px(5, 12, 2, 9, accent);
    px(9, 12, 2, 9, accent);
    px(6, 19, 5, 2, "#edede0");
    px(8, 13, 1, 6, "#343c56");
    px(3, 16, 3, 1, "#eff2df");
    px(11, 16, 3, 1, "#eff2df");
  }
  if (outfit === "striped") {
    for (const row of [14, 16, 18]) px(3, row, 10, 1, accent);
    px(6, 12, 4, 1, accent);
    px(6, 13, 1, 1, accent);
    px(9, 13, 1, 1, accent);
  }
  if (outfit === "embroidered") {
    px(6, 12, 5, 2, accent);
    px(7, 13, 3, 1, "#f9d468");
    for (const a of [4, 10]) {
      px(a, 15, 2, 1, "#e95594");
      px(a - 0.5, 16, 3, 1, "#e95594");
      px(a + 0.5, 16, 1, 1, "#ffd659");
      px(a + 0.5, 17, 1, 2, "#318b83");
      px(a - 0.5, 18, 1, 1, "#318b83");
    }
    px(3, 20, 10, 1, accent);
  }
  if (outfit === "skeleton") {
    px(7.5, 12, 1, 8, "#f3eedc");
    for (const row of [13, 15, 17]) {
      px(5, row, 2.5, 1, "#f3eedc");
      px(8.5, row, 2.5, 1, "#f3eedc");
    }
    px(2.5, 14, 1, 4, "#f3eedc");
    px(12.5, 14, 1, 4, "#f3eedc");
  }
  if (outfit === "festive") {
    px(3, 13, 10, 1, "#f7e9d6");
    px(3, 19, 10, 1, "#f7e9d6");
    px(7, 14, 2, 1, "#eecd77");
    px(6, 15, 4, 1, "#91c99b");
    px(5, 16, 6, 1, "#91c99b");
    px(4, 17, 8, 1, "#91c99b");
    px(7, 18, 2, 1, "#f7e9d6");
    px(3, 15, 1, 1, "#f7e9d6");
    px(12, 15, 1, 1, "#f7e9d6");
  }
  px(4, 20, 8, 2, shade(pants, -12));
  px(4, 21, 3, seated ? 4 : 5, pants);
  px(9, 21, 3, seated ? 4 : 5, shade(pants, -12));
  px(3, seated ? 24 : 25, 4, 2, shoes);
  px(9, seated ? 24 : 25, 4, 2, shoes);
  px(3, seated ? 25 : 26, 4, 1, shade(shoes, 26));
  px(9, seated ? 25 : 26, 4, 1, shade(shoes, 26));
  px(4, 3, 8, 7, skin);
  px(3, 5, 1, 3, skin);
  px(12, 5, 1, 3, shade(skin, -18));
  px(10, 4, 2, 6, shade(skin, -12));
  if (style !== "bald") {
    px(4, 1, 8, style === "buzz" ? 2 : 3, hair);
    px(3, 2, 10, style === "buzz" ? 1 : 2, hair);
    px(3, 4, style === "buzz" ? 1 : 2, style === "buzz" ? 1 : 3, hair);
  }
  if (style === "wave") {
    px(4, 0, 7, 1, hair);
    px(8, 3, 4, 2, hair);
    px(12, 3, 1, 4, hair);
    px(3, 2, 3, 2, shade(hair, 18));
  }
  if (style === "short" || style === "ponytail") {
    px(10, 3, 2, 2, hair);
    px(4, 1, 4, 1, shade(hair, 20));
  }
  if (style === "long") {
    px(3, 3, 3, 3, hair);
    px(11, 3, 2, 7, hair);
  }
  px(6, 6, 1, 1, dark);
  px(10, 6, 1, 1, dark);
  px(8, 8, 2, 1, shade(skin, -35));
  if (look.facialHair === "stubble") {
    px(5, 9, 6, 1, shade(skin, -40));
    px(4, 8, 1, 2, shade(skin, -40));
  }
  if (look.facialHair === "beard") {
    px(4, 8, 2, 2, hair);
    px(10, 8, 2, 2, hair);
    px(5, 9, 6, 2, hair);
    px(7, 11, 3, 1, hair);
    px(8, 9, 2, 1, shade(skin, -35));
  }
  if (look.facialHair === "mustache") {
    px(6, 8, 2, 1, hair);
    px(9, 8, 2, 1, hair);
  }
  if (look.facePaint === "calavera") {
    px(4, 4, 8, 6, "#f7ebd6");
    px(5, 5, 3, 3, "#6a436b");
    px(9, 5, 3, 3, "#6a436b");
    px(6, 6, 1, 1, "#f3d37a");
    px(10, 6, 1, 1, "#f3d37a");
    px(8, 8, 1, 1, "#6a436b");
    px(5, 9, 6, 1, "#6a436b");
    for (const a of [5, 7, 9, 11]) px(a, 9, 1, 1, "#f7ebd6");
    px(7, 4, 2, 1, "#e55699");
    px(4, 8, 1, 1, "#e55699");
    px(11, 8, 1, 1, "#e55699");
  }
  if (look.eyewear === "sun") {
    px(4, 5, 4, 3, dark);
    px(9, 5, 4, 3, dark);
    px(8, 6, 1, 1, dark);
    px(5, 5, 2, 1, "#7689a4");
    px(10, 5, 2, 1, "#7689a4");
  }
  if (look.eyewear === "optical" || look.eyewear === "round") {
    // Thin, clear frames keep eyes visible at both preview and desk sizes.
    const frameColor = "#635363";
    for (const a of [4.5, 9]) {
      if (look.eyewear === "round") {
        px(a + 0.5, 4.75, 2.5, 0.5, frameColor);
        px(a + 0.5, 7.5, 2.5, 0.5, frameColor);
        px(a, 5.25, 0.5, 2.25, frameColor);
        px(a + 3, 5.25, 0.5, 2.25, frameColor);
        px(a + 0.25, 5, 0.5, 0.5, frameColor);
        px(a + 2.75, 5, 0.5, 0.5, frameColor);
      } else {
        px(a, 5, 3.5, 0.5, frameColor);
        px(a, 7.5, 3.5, 0.5, frameColor);
        px(a, 5, 0.5, 3, frameColor);
        px(a + 3, 5, 0.5, 3, frameColor);
      }
      px(a + 0.75, 5.25, 0.5, 0.5, "#c1dce2");
    }
    px(8, 5.75, 1, 0.5, frameColor);
  }
  if (look.headwear === "cap") {
    px(3, -1, 10, 4, accent);
    px(8, 2, 7, 1, shade(accent, -30));
    px(5, 0, 2, 1, shade(accent, 25));
  }
  if (look.headwear === "beanie") {
    px(4, -2, 8, 2, accent);
    px(3, 0, 10, 3, accent);
    px(3, 2, 10, 1, shade(accent, -25));
    px(5, -1, 1, 2, shade(accent, 22));
  }
  if (look.headwear === "flowers") {
    px(3, 0, 10, 1, "#75937c");
    for (const a of [3, 6, 9, 12]) {
      px(a, -1, 2, 2, accent);
      px(a + 0.5, -0.5, 1, 1, "#f3d9a1");
    }
  }
  if (look.headwear === "santa") {
    px(3, 0, 10, 2, "#eee8dc");
    px(4, -2, 8, 2, accent);
    px(6, -4, 6, 2, accent);
    px(11, -3, 3, 2, accent);
    px(13, -1, 2, 2, "#eee8dc");
  }
  if (look.headwear === "witch") {
    px(2, 1, 13, 1, "#44374e");
    px(4, -1, 8, 2, "#53425f");
    px(6, -3, 4, 2, "#53425f");
    px(7, -4, 2, 1, "#53425f");
    px(4, 0, 8, 1, accent);
  }
  if (look.headwear === "kabuto") {
    px(3, 0, 10, 4, "#364059");
    px(4, -2, 8, 3, "#475576");
    px(5, -3, 6, 1, "#475576");
    px(3, 2, 10, 1, accent);
    px(1, -4, 2, 5, accent);
    px(13, -4, 2, 5, accent);
    px(2, 0, 3, 2, accent);
    px(11, 0, 3, 2, accent);
    px(7, -2, 2, 3, accent);
    px(2, 4, 2, 5, "#42526a");
    px(12, 4, 2, 5, "#42526a");
  }
  if (look.headwear === "straw") {
    px(4, -2, 8, 3, "#e5bd70");
    px(3, 0, 10, 2, "#f2d298");
    px(-3, 2, 22, 1, "#e3b96e");
    px(3, 1, 10, 1, accent);
    px(5, -1, 2, 1, "#f7e0ae");
  }
  if (look.audio === "headphones") {
    px(3, 1, 10, 1, "#919caf");
    px(2, 2, 1, 5, "#919caf");
    px(13, 2, 1, 5, "#919caf");
    px(1, 5, 3, 4, "#536074");
    px(12, 5, 3, 4, "#536074");
    px(2, 6, 1, 2, accent);
    px(13, 6, 1, 2, accent);
  }
  if (look.audio === "earbuds") {
    px(3, 6, 1, 3, "#f0e9df");
    px(12, 6, 1, 3, "#f0e9df");
  }
  if (look.neckwear === "scarf") {
    px(5, 11, 7, 2, accent);
    px(10, 13, 2, 4, accent);
    px(10, 16, 2, 1, shade(accent, -25));
  }
  if (look.neckwear === "tie") {
    px(8, 12, 2, 2, accent);
    px(8, 14, 1, 4, accent);
    px(7, 17, 3, 1, accent);
  }
  if (look.neckwear === "necklace") {
    px(6, 13, 1, 2, "#d3b768");
    px(10, 13, 1, 2, "#d3b768");
    px(7, 15, 3, 1, "#d3b768");
    px(8, 16, 1, 1, accent);
  }
  if (frame && seated) {
    px(1, 17, 3, 2, skin);
    px(12, 16, 3, 2, skin);
  }
}

export function drawAvatar(
  canvas: HTMLCanvasElement,
  look: Avatar,
  full = false,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  // Fixed framing lets users actually see height differences without auto-zoom.
  const scale = Math.min(canvas.width / (full ? 26 : 24), canvas.height / 37);
  drawPixelAvatar(
    ctx,
    look,
    canvas.width / 2 - 8 * scale,
    canvas.height - 28 * scale,
    scale,
  );
}
