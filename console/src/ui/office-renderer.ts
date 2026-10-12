import {
  drawPixelAvatar as avatar,
  drawAvatar,
  avatarBounds,
} from "./avatar-renderer";
import {
  COFFEE_COUNTER,
  DECISION_SIGN,
  DECISION_TABLE,
  DESK,
  officeLayout,
  assignStudioSeats,
  deskKit,
  deskScreens,
  getStudioLayout,
  floorPoint,
  roomGrowth,
  SEAT_LABEL_DROP,
  seatSpots,
  type DeskKit,
} from "./office-layout";

import {
  normalizeStudioPreferences,
  resolveSceneTheme,
  type StudioPreferences,
} from "../studio/model";
import type { AgentStatus, Avatar } from "../contracts";
import type { Haunt, Rect } from "../studio/idle-life";
import {
  drawWindowLandscape,
  drawStudioDecor,
  drawFloorDetail,
} from "../studio/scene-decor";
import {
  drawStudioSurroundings,
  drawPlaceArchitecture,
  drawWindowIdentity,
  drawPlaceWallArt,
} from "../studio/scene-motifs";

export type SceneAgent = {
  id: string;
  name: string;
  avatar: Avatar;
  status: AgentStatus;
  bubble: { tone: BubbleTone; text: string } | null;
  role: string;
  kind: "manager" | "worker" | "advisor";
  // Work that happens beside someone else: advising the Manager, reviewing a developer's order.
  errand?: { beside: string; doing: string } | null;
};
export type SceneState = {
  name: string;
  accent: string;
  paused: boolean;
  agents: SceneAgent[];
  pending: number;
  openOrders: number;
  delivered?: number;
  settings?: StudioPreferences;
};
export type BubbleTone = "ask" | "alert" | "done" | "busy" | "wait";
export const BUBBLE_FILL: Record<BubbleTone, string> = {
  ask: "#f3c299",
  alert: "#eba9ad",
  done: "#b4debf",
  busy: "#d2c3ed",
  wait: "#c9c6d4",
};
export const BUBBLE_STEP_MS = 300;
// Canvas pixels from the floor under a chair to the top of the sprite of whoever sits on it.
export const SEATED_TOP = 90;
/** Heights of a screen's bottom and top edge above the floor. */
export const SCREEN = { bottom: 54, top: 79 };
/** One cut of the scene on its own transparent canvas, placed at (x, y) of the office canvas. */
export type Piece = {
  kind: "base" | "prop" | "labels" | "front" | "board";
  depth: number;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  footprint?: Rect;
  haunt?: Haunt;
};
type Solid = { footprint?: Rect; haunt?: Haunt };
type Point = [number, number];
type BoardTools = {
  p: (u: number, v: number, z?: number) => Point;
  block: (u: number, v: number, w: number, d: number, h: number, fill: string, z?: number) => void;
  poly: (points: Point[], fill: string, stroke?: string) => void;
  text: (value: string, x: number, y: number, font: string, fill: string, align?: CanvasTextAlign) => void;
};
type Hit = {
  id: string;
  kind: "agent" | "zone" | "bubble";
  x: number;
  y: number;
  r: number;
  ry?: number;
};

const color = (hex: string, amount: number) =>
  "#" +
  hex
    .slice(1)
    .match(/../g)!
    .map((v) =>
      Math.max(0, Math.min(255, parseInt(v, 16) + amount))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
class Office {
  hover: string | null = null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private hits: Hit[] = [];
  private cut: ((kind: Piece["kind"], depth?: number, solid?: Solid) => void) | null = null;
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }
  /**
   * The scenery without anyone in it, cut into pieces a stage can stack and move things between: the room, every
   * piece of furniture with its depth, the seat labels, the steps and the board. Needs a real canvas.
   */
  pieces(state: SceneState): Piece[] {
    const pieces: Piece[] = [];
    this.cut = (kind, depth = 0, solid = {}) => {
      const cropped = cropPainted(this.canvas);
      if (cropped) pieces.push({ kind, depth, ...cropped, ...solid });
      this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    };
    try {
      this.draw(state);
    } finally {
      this.cut = null;
    }
    return pieces;
  }
  draw(state: SceneState, time = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const settings = normalizeStudioPreferences(state.settings);
    const layout = getStudioLayout(settings.layout);
    const theme = resolveSceneTheme(settings);
    const palette = theme.palette;
    const W = officeLayout.width,
      H = officeLayout.height;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    this.hits = [];
    const p = floorPoint;
    const poly = (points: Point[], fill: string, stroke?: string) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    const line = (a: Point, b: Point, stroke: string, width = 1) => {
      ctx.beginPath();
      ctx.moveTo(...a);
      ctx.lineTo(...b);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const text = (
      str: string,
      x: number,
      y: number,
      font: string,
      fill: string,
      align: CanvasTextAlign = "left",
    ) => {
      ctx.font = font;
      ctx.fillStyle = fill;
      ctx.textAlign = align;
      ctx.fillText(str, x, y);
      ctx.textAlign = "left";
    };
    const block = (
      u: number,
      v: number,
      w: number,
      d: number,
      h: number,
      fill: string,
      z = 0,
    ) => {
      poly(
        [
          p(u, v, z + h),
          p(u + w, v, z + h),
          p(u + w, v + d, z + h),
          p(u, v + d, z + h),
        ],
        color(fill, 18),
      );
      poly(
        [
          p(u, v + d, z + h),
          p(u + w, v + d, z + h),
          p(u + w, v + d, z),
          p(u, v + d, z),
        ],
        color(fill, -14),
      );
      poly(
        [
          p(u + w, v, z + h),
          p(u + w, v + d, z + h),
          p(u + w, v + d, z),
          p(u + w, v, z),
        ],
        color(fill, -30),
      );
    };
    const plant = (u: number, v: number, size = 1) => {
      const [x, y] = p(u, v);
      poly(
        [
          [x - 13 * size, y],
          [x + 10 * size, y + 4],
          [x + 8 * size, y + 22 * size],
          [x - 9 * size, y + 18 * size],
        ],
        "#ae826c",
      );
      poly(
        [
          [x - 13 * size, y],
          [x - 2 * size, y - 6 * size],
          [x + 12 * size, y],
          [x + 1 * size, y + 6 * size],
        ],
        "#d5a084",
      );
      line([x, y], [x, y - 41 * size], "#5f8f78", 3 * size);
      (
        [
          [-15, -25, -8, -40],
          [9, -27, 18, -42],
          [-13, -44, -2, -50],
          [2, -35, 13, -54],
          [0, -48, -5, -63],
          [-19, -35, -25, -47],
        ] as const
      ).forEach(([a, b, c, d]) =>
        poly(
          [
            [x, y + b * size + 10],
            [x + a * size, y + b * size],
            [x + c * size, y + d * size],
            [x + a * size * 0.5, y + d * size - 2],
          ],
          a < 0 ? palette.foliage : palette.foliageLight,
        ),
      );
    };
    // A screen faces whoever sits behind the desk, so the room sees its back.
    const monitor = (u: number, v: number, w: number) => {
      const y = SCREEN.bottom,
        h = SCREEN.top - SCREEN.bottom;
      // The foot and the neck stand under the middle of the screen and reach into it, or the screen reads as floating.
      block(u + w / 2 - 0.15, v - 0.06, 0.3, 0.16, 2, "#667886", 47);
      block(u + w / 2 - 0.045, v - 0.05, 0.09, 0.07, y - 45, "#697986", 49);
      block(u, v, w, 0.05, h, "#4a5563", y);
      poly(
        [p(u + 0.07, v + 0.05, y + h - 4), p(u + w - 0.07, v + 0.05, y + h - 4), p(u + w - 0.07, v + 0.05, y + 5), p(u + 0.07, v + 0.05, y + 5)],
        "#3d4755",
      );
      const [dotX, dotY] = p(u + w / 2, v + 0.05, y + h / 2);
      ctx.fillStyle = "#93a7b8";
      ctx.fillRect(dotX - 2, dotY - 2, 4, 4);
    };
    const mug = (u: number, v: number) => block(u, v, 0.14, 0.14, 9, "#eedcc0", 49);
    // What a desk carries besides its screens, by whose desk it is. Everything stands on the top, 49 above the floor.
    const deskThings: Record<DeskKit, (u: number, v: number) => void> = {
      plain: (u, v) => mug(u + 1.7, v + 0.5),
      lead: (u, v) => {
        block(u + 1.42, v + 0.62, 0.44, 0.08, 7, "#d9c7a0", 49);
        block(u + 1.72, v + 0.1, 0.16, 0.16, 8, "#b9876d", 49);
        const [x, y] = p(u + 1.8, v + 0.18, 57);
        line([x, y], [x - 4, y - 12], "#5f8f78", 3);
        line([x, y], [x + 5, y - 10], "#7fae8f", 3);
      },
      dual: (u, v) => {
        block(u + 1.45, v + 0.5, 0.42, 0.1, 6, "#9cc0d6", 49);
        block(u + 1.45, v + 0.62, 0.42, 0.1, 6, "#c4dbe8", 49);
        mug(u + 1.72, v + 0.12);
      },
      dev: (u, v) => {
        // The laptop is open toward its owner too: the lid shows its back.
        block(u + 0.06, v + 0.38, 0.46, 0.3, 2, "#59606e", 49);
        poly([p(u + 0.06, v + 0.68, 51), p(u + 0.52, v + 0.68, 51), p(u + 0.52, v + 0.74, 70), p(u + 0.06, v + 0.74, 70)], "#4a5361");
        const [lidX, lidY] = p(u + 0.29, v + 0.71, 61);
        ctx.fillStyle = "#93a7b8";
        ctx.fillRect(lidX - 2, lidY - 2, 4, 4);
        const [x, y] = p(u + 1.68, v + 0.6, 51);
        ctx.strokeStyle = "#3d4250";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y - 3, 7, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = "#6d8f86";
        ctx.fillRect(x - 10, y - 5, 5, 8);
        ctx.fillRect(x + 5, y - 5, 5, 8);
      },
      tablet: (u, v) => {
        block(u + 1.4, v + 0.42, 0.48, 0.36, 2, "#3f4552", 49);
        block(u + 1.44, v + 0.46, 0.4, 0.28, 1, "#d9c9ea", 51);
        ["#e36077", "#f3c15a", "#59b6a4"].forEach((swatch, index) => block(u + 0.08 + index * 0.13, v + 0.62, 0.11, 0.16, 2, swatch, 49));
      },
      papers: (u, v) => {
        block(u + 1.44, v + 0.44, 0.4, 0.34, 6, "#f1ead9", 49);
        block(u + 1.46, v + 0.48, 0.4, 0.34, 2, "#fffaf0", 55);
        line(p(u + 1.52, v + 0.6, 58), p(u + 1.8, v + 0.6, 58), "#c8574f", 2);
        mug(u + 1.74, v + 0.1);
      },
    };
    ctx.fillStyle = palette.backdrop;
    ctx.fillRect(0, 0, W, H);
    for (let row = 0; row * 45 < H; row++) {
      for (let col = 0; col * 57 < W; col++) {
        ctx.fillStyle = "#8e83951b";
        ctx.fillRect(24 + col * 57 + (row % 2 ? 28 : 0), 28 + row * 45, 2, 2);
      }
    }
    // The theme scenery was drawn for a smaller room: what it pinned to the far walls moves out with them.
    const east = (u: number) => (u > 7 ? u + roomGrowth.east : u);
    const south = (v: number) => (v > 5.2 ? v + roomGrowth.south : v);
    const pinned = {
      ctx,
      poly,
      line,
      p: (u: number, v: number, z?: number) => p(east(u), south(v), z),
      block: (u: number, v: number, w: number, d: number, h: number, fill: string, z?: number) =>
        block(east(u), south(v), w, d, h, fill, z),
    };
    drawStudioSurroundings(pinned, theme);
    const { width: rw, depth: rd, wallHeight: wh } = officeLayout.room;
    poly(
      [
        p(-0.8, -0.5, -28),
        p(rw + 0.9, -0.5, -28),
        p(rw + 0.9, rd + 0.9, -28),
        p(-0.8, rd + 0.9, -28),
      ],
      "#191c28",
    );
    poly([p(0, rd), p(rw, rd), p(rw, rd, -18), p(0, rd, -18)], "#787484");
    poly([p(rw, 0), p(rw, rd), p(rw, rd, -18), p(rw, 0, -18)], "#5e5c70");
    poly([p(0, 0), p(rw, 0), p(rw, rd), p(0, rd)], palette.floorAlt);
    for (let u = 0; u < rw; u++) {
      for (let v = 0; v < rd; v++) {
        const edge = Math.min(v + 1, rd);
        poly(
          [p(u, v), p(u + 1, v), p(u + 1, edge), p(u, edge)],
          (u + v) % 2 ? palette.floor : palette.floorAlt,
          "#a4938744",
        );
        drawFloorDetail({ p, poly, line }, u, v, edge, theme);
      }
    }
    poly([p(0, 0, wh), p(0, rd, wh), p(0, rd), p(0, 0)], palette.wallLeft);
    poly([p(0, 0, wh), p(rw, 0, wh), p(rw, 0), p(0, 0)], palette.wallRight);
    line(p(0, 0, wh), p(0, rd, wh), palette.trim, 6);
    line(p(0, 0, wh), p(rw, 0, wh), palette.trim, 6);
    line(p(0, 0, 8), p(0, rd, 8), "#b1a08b", 5);
    line(p(0, 0, 8), p(rw, 0, 8), "#aaa097", 5);
    drawPlaceArchitecture(pinned, theme);
    for (let i = 0; 0.6 + i * 1.85 + 1.5 < rd; i++) {
      const v = 0.6 + i * 1.85;
      poly(
        [
          p(0.01, v, 122),
          p(0.01, v + 1.4, 122),
          p(0.01, v + 1.4, 44),
          p(0.01, v, 44),
        ],
        "#787681",
      );
      poly(
        [
          p(0.03, v + 0.08, 117),
          p(0.03, v + 1.32, 117),
          p(0.03, v + 1.32, 50),
          p(0.03, v + 0.08, 50),
        ],
        palette.horizon,
      );
      poly(
        [
          p(0.04, v + 0.08, 117),
          p(0.04, v + 1.32, 117),
          p(0.04, v + 1.32, 91),
          p(0.04, v + 0.08, 91),
        ],
        palette.sky,
      );
      drawWindowLandscape({ p, poly, line }, v, i, theme);
      line(p(0.06, v + 0.7, 119), p(0.06, v + 0.7, 47), "#e9e1cd", 3);
      line(p(0.06, v + 0.06, 86), p(0.06, v + 1.34, 86), "#e9e1cd", 3);
      block(-0.05, v - 0.01, 0.2, 1.44, 5, "#efdcc0", 43);
      drawWindowIdentity({ ctx, p, poly, line }, v, theme);
    }
    const wallSign = p(2.15, 0.04, 106);
    ctx.save();
    ctx.translate(...wallSign);
    ctx.transform(1, 0.5, 0, 1, 0, 0);
    ctx.fillStyle = "#3a414a";
    ctx.fillRect(-14, -28, 225, 44);
    text(state.name.slice(0, 18), 0, 0, "bold 20px monospace", state.accent);
    ctx.restore();
    const wallBoard = (u: number, title: string, fill: string) => {
      poly(
        [
          p(u, 0.04, 113),
          p(u + 2, 0.04, 113),
          p(u + 2, 0.04, 49),
          p(u, 0.04, 49),
        ],
        "#f0e5ce",
      );
      poly(
        [
          p(u + 0.08, 0.06, 107),
          p(u + 1.92, 0.06, 107),
          p(u + 1.92, 0.06, 56),
          p(u + 0.08, 0.06, 56),
        ],
        fill,
      );
      for (let j = 0; j < 6; j++) {
        const a = u + 0.25 + (j % 3) * 0.52;
        const z = 97 - Math.floor(j / 3) * 20;
        poly(
          [
            p(a, 0.07, z),
            p(a + 0.32, 0.07, z),
            p(a + 0.32, 0.07, z - 12),
            p(a, 0.07, z - 12),
          ],
          ["#d1bcaa", "#a9c3b0", "#bca8d0"][j % 3]!,
        );
      }
      const at = p(u + 0.16, 0.07, 42);
      ctx.save();
      ctx.translate(...at);
      ctx.transform(1, 0.5, 0, 1, 0, 0);
      text(title, 0, 0, "11px monospace", "#5d5665");
      ctx.restore();
    };
    if (settings.place === "studio") {
      wallBoard(9.2, "IDEAS / DESIGN", "#767486");
      wallBoard(13.2, "VISION / SCOPE", "#718980");
    } else drawPlaceWallArt(pinned, theme);
    for (const zone of layout.zones) {
      poly(
        [
          p(zone.u, zone.v, 0.5),
          p(zone.u + zone.width, zone.v, 0.5),
          p(zone.u + zone.width, zone.v + zone.depth, 0.5),
          p(zone.u, zone.v + zone.depth, 0.5),
        ],
        color(settings.place === "studio" ? zone.color : palette.rug, -10) +
          (settings.place === "studio" ? "" : "55"),
      );
      poly(
        [
          p(zone.u + 0.12, zone.v + 0.12, 0.8),
          p(zone.u + zone.width - 0.12, zone.v + 0.12, 0.8),
          p(zone.u + zone.width - 0.12, zone.v + zone.depth - 0.12, 0.8),
          p(zone.u + 0.12, zone.v + zone.depth - 0.12, 0.8),
        ],
        settings.place === "studio"
          ? zone.color
          : color(
              palette.rug,
              zone.id === "design" ? 7 : zone.id === "development" ? -9 : 0,
            ) + "55",
      );
    }
    const live = this.cut !== null;
    this.cut?.("base");
    const objects: Array<{ depth: number; fn: () => void; solid: Solid }> = [],
      labels: Array<() => void> = [];
    const add = (depth: number, fn: () => void, solid: Solid = {}) => {
      objects.push({ depth, fn, solid });
    };
    const partition = (
      u: number,
      v: number,
      w: number,
      d: number,
      height = 42,
    ) => {
      const footprint = { u, v, width: w, depth: d };
      add(u + v + (w + d) / 2, () => {
        block(u, v, w, d, 18, "#e2d9c6");
        block(u, v, w, d, 4, "#e7e1d2", height);
        const a = p(u, v, height),
          b = p(u + w, v + d, height);
        line(a, b, "#879ca6", 3);
        line(p(u, v, 18), a, "#879ca6", 3);
        line(p(u + w, v + d, 18), b, "#879ca6", 3);
        poly(
          [
            p(u, v, height),
            p(u + w, v + d, height),
            p(u + w, v + d, 18),
            p(u, v, 18),
          ],
          "#b0d0cc44",
        );
      }, { footprint });
    };
    for (const item of layout.partitions)
      partition(item.u, item.v, item.width, item.depth, item.height);
    add(2, () => {
      block(0.6, 0.3, 1.2, 0.55, 62, "#7e8490");
      for (let i = 0; i < 3; i++) {
        line(
          p(0.65, 0.87, 15 + i * 16),
          p(1.75, 0.87, 15 + i * 16),
          "#d8cbb9",
          2,
        );
        for (let b = 0; b < 5; b++)
          block(
            0.68 + b * 0.2,
            0.83,
            0.13,
            0.06,
            12,
            ["#bc91a3", "#94b2b6", "#b7b29a"][b % 3]!,
            17 + i * 16,
          );
      }
    });
    add(4.8, () => plant(0.65, 3.7, 1.05));
    if (
      !theme.decor.some((id) => ["cactus", "bonsai", "marigolds"].includes(id))
    )
      add(rw - 0.2, () => plant(rw - 1, 0.7, 1.05));
    if (
      !theme.decor.some((id) =>
        ["parasol", "tree", "pumpkins", "ofrenda"].includes(id),
      )
    )
      add(rd + 0.1, () => plant(0.5, rd - 0.7, 1.1));
    add(rw + rd - 2.5, () => plant(rw - 0.9, rd - 1.6, 1.1));
    if (!theme.decor.includes("ofrenda"))
      add(COFFEE_COUNTER.u + COFFEE_COUNTER.v + 1.4, () => {
        const { u, v } = COFFEE_COUNTER;
        block(u, v, 2.2, 0.55, 40, "#c8b49b");
        block(u, v, 2.2, 0.55, 4, "#ecdac0", 40);
        block(u + 0.25, v + 0.07, 0.33, 0.32, 25, "#647581", 44);
        block(u + 0.9, v + 0.08, 0.19, 0.2, 10, "#b79172", 44);
        block(u + 1.23, v + 0.08, 0.17, 0.17, 8, "#f0e0c6", 44);
      }, {
        footprint: COFFEE_COUNTER,
        haunt: { u: COFFEE_COUNTER.u + 2.9, v: COFFEE_COUNTER.v + 0.2, doing: "coffee" },
      });
    drawStudioDecor({ ...pinned, add }, theme);
    const seats = assignStudioSeats(state.agents, layout);
    const tag = (
      member: SceneAgent,
      x: number,
      top: number,
      bottom: number,
      [labelX, labelTop]: Point,
    ) => {
      const bounds = avatarBounds(member.avatar);
      this.hits.push({ id: member.id, kind: "agent", x, y: (top + bottom) / 2, r: 44 });
      if (this.hover === member.id) {
        ctx.strokeStyle = "#d7efd9";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          x - 25 + bounds.left * 3.2 - 5,
          top - 4,
          (bounds.right - bounds.left) * 3.2 + 10,
          bottom + 4 - top,
        );
      }
      const bubble = member.bubble;
      if (bubble)
        labels.push(() => {
          const step = Math.floor(time / BUBBLE_STEP_MS);
          const busy = bubble.tone === "busy";
          const label = busy ? "·".repeat(1 + (step % 3)) : bubble.text;
          const width = busy ? 34 : label.length * 7 + 16;
          const calls = bubble.tone !== "busy" && bubble.tone !== "wait";
          const left = x + 3 - width / 2;
          const bubbleTop = top - 31 - (calls && step % 2 ? 3 : 0);
          const id = `bubble:${member.id}`;
          ctx.fillStyle = BUBBLE_FILL[bubble.tone];
          ctx.fillRect(left, bubbleTop, width, 19);
          poly(
            [
              [x - 3, bubbleTop + 19],
              [x + 9, bubbleTop + 19],
              [x + 3, bubbleTop + 26],
            ],
            ctx.fillStyle,
          );
          if (this.hover === id) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.strokeRect(left - 1, bubbleTop - 1, width + 2, 21);
          }
          text(
            label,
            busy ? left + 9 : x + 3,
            bubbleTop + 14,
            "bold 11px monospace",
            "#2f3340",
            busy ? "left" : "center",
          );
          this.hits.push({
            id,
            kind: "bubble",
            x: x + 3,
            y: bubbleTop + 11,
            r: Math.max(width / 2 + 4, 18),
            ry: 16,
          });
        });
      labels.push(() => {
        const name = member.name.slice(0, 17),
          width = Math.max(60, name.length * 7 + 16);
        ctx.fillStyle = "#31363fe8";
        ctx.fillRect(labelX - width / 2, labelTop, width, 23);
        text(
          name,
          labelX,
          labelTop + 16,
          "12px monospace",
          member.status === "working" ? "#d2c3ed" : "#d7e6d8",
          "center",
        );
      });
    };
    for (const seat of seats) {
      const { u, v, agent: member, zone } = seat;
      const active = member?.status === "working";
      const spots = seatSpots(seat);
      const kit = deskKit(member);
      const [x, y] = p(spots.chair.u, spots.chair.v);
      const upholstery = zone === "manager" ? "#617e70" : "#677488";
      add(u + v + 0.15, () => {
        line([x, y - 16], [x, y + 3], "#484957", 3);
        line([x - 12, y + 2], [x + 12, y + 2], "#484957", 3);
        // The back is drawn square to the room, right behind whoever sits facing it.
        poly([[x - 20, y - 74], [x + 20, y - 74], [x + 20, y - 24], [x - 20, y - 24]], color(upholstery, -12));
        poly([[x - 17, y - 71], [x + 17, y - 71], [x + 17, y - 27], [x - 17, y - 27]], upholstery);
        if (member && !live)
          avatar(ctx, member.avatar, x - 25, y - SEATED_TOP, 3.2, true, active ? Math.floor(time / 500) % 2 : 0);
      });
      add(u + v + 1, () => {
        for (const [du, dv] of [
          [0.1, 0.1],
          [1.7, 0.1],
          [0.1, 0.68],
          [1.7, 0.68],
        ] as const)
          block(u + du, v + dv, 0.08, 0.09, 43, "#8a7b70");
        const wood = zone === "manager" ? color(palette.wood, -12) : palette.wood;
        // The front panel is what makes someone behind the desk read as sitting at it: only chest and head show.
        block(u + 0.14, v + 0.1, DESK.width - 0.28, 0.06, 37, color(wood, -22), 6);
        block(u, v, DESK.width, DESK.depth, 5, wood, 43);
        block(u + 0.86, v + 0.08, 0.6, 0.15, 2, "#e5d6c4", 49);
        for (let k = 0; k < 5; k++)
          line(p(u + 0.91 + k * 0.11, v + 0.09, 51), p(u + 0.91 + k * 0.11, v + 0.2, 51), "#9c95a5");
        for (const screen of deskScreens(seat, kit)) monitor(screen.u, screen.v, screen.width);
        deskThings[kit](u, v);
        const [lx, ly] = [x, y + SEAT_LABEL_DROP];
        if (member && !live) {
          const top = y - SEATED_TOP + avatarBounds(member.avatar).top * 3.2;
          tag(member, x, top, y - 40, [lx, ly]);
        } else if (!member) {
          labels.push(() => text("OPEN SEAT", lx, ly + 15, "10px monospace", "#615969", "center"));
        }
      }, {
        footprint: spots.footprint,
        ...(member ? { haunt: { ...spots.visitor, doing: `with ${member.name.slice(0, 12)}`, owner: member.id } } : {}),
      });
    }
    // A shared decision table belongs to the director, not to a worker run.
    add(DECISION_TABLE.u + DECISION_TABLE.v + 2.45, () => {
      const { u: tu, v: tv } = DECISION_TABLE;
      // Legs first: painted after the top, the far ones showed through it.
      for (const [du, dv] of [
        [0.15, 0.15],
        [3.25, 0.15],
        [0.15, 1.25],
        [3.25, 1.25],
      ] as const)
        block(tu + du, tv + dv, 0.12, 0.12, 41, "#88776c");
      block(tu, tv, 3.5, 1.4, 5, "#bd9a81", 41);
      for (const du of [0.3, 1.6, 2.85]) {
        block(tu + du, tv + 1.6, 0.6, 0.52, 21, "#83918d");
        block(tu + du, tv + 2.07, 0.6, 0.09, 30, "#92a49b");
      }
      block(tu + 0.4, tv + 0.45, 0.45, 0.42, 2, "#d7c7e2", 47);
      block(tu + 1.3, tv + 0.25, 0.6, 0.42, 2, "#e6ddc3", 47);
      block(tu + 2.55, tv + 0.55, 0.2, 0.2, 8, "#c2e1c7", 47);
      const [x, y] = p(DECISION_SIGN.u, DECISION_SIGN.v, DECISION_SIGN.z);
      this.hits.unshift({ id: "decisions", kind: "zone", x, y: y + 12, r: 70 });
      if (!live) labels.push(() => {
        const lit = state.pending > 0;
        ctx.fillStyle = lit ? "#ecd0a7" : "#dae3d3";
        ctx.fillRect(x - 76, y - 17, 152, 42);
        poly(
          [
            [x - 5, y + 25],
            [x + 9, y + 25],
            [x + 2, y + 34],
          ],
          ctx.fillStyle,
        );
        text(
          lit ? `${state.pending} TO DECIDE` : "DECISION DESK",
          x,
          y + 1,
          "bold 12px monospace",
          "#46514a",
          "center",
        );
        text("OPEN INBOX →", x, y + 17, "9px monospace", "#5e675a", "center");
      });
    }, { footprint: DECISION_TABLE });
    for (const object of objects.sort((a, b) => a.depth - b.depth)) {
      object.fn();
      this.cut?.("prop", object.depth, object.solid);
    }
    labels.forEach((drawLabel) => drawLabel());
    this.cut?.("labels");
    const unseated =
      state.agents.length - seats.filter((seat) => seat.agent).length;
    block(5.25, rd + 0.08, 2.8, 0.35, 9, "#898293", -18);
    block(5.45, rd + 0.48, 2.4, 0.3, 6, "#716b83", -27);
    const [tx, ty] = p(6.5, rd + 1.1, -29);
    text(
      "YOUR VISION. THEIR WORK.",
      tx,
      ty + 22,
      "12px monospace",
      "#898397",
      "center",
    );
    this.cut?.("front");
    this.drawBoard(live ? null : state.openOrders, rd, { p, block, poly, text });
    this.cut?.("board");
    if (unseated > 0 && !live) {
      ctx.fillStyle = "#31363fe8";
      ctx.fillRect(tx - 84, ty + 32, 168, 23);
      text(
        `+${unseated} MORE ON THE TEAM`,
        tx,
        ty + 48,
        "12px monospace",
        "#d7e6d8",
        "center",
      );
    }
  }
  // A way into the work orders, not a live board: it only says how many are open.
  private drawBoard(
    openOrders: number | null,
    rd: number,
    { p, block, poly, text }: BoardTools,
  ): void {
    const u = 1.6;
    const v = rd + 0.55;
    for (const leg of [u + 0.1, u + 1.75]) block(leg, v, 0.07, 0.07, 22, "#6d6a78", -18);
    block(u, v - 0.02, 1.95, 0.1, 44, "#8f8a9b", 2);
    const corner = (du: number, dz: number): Point => p(u + du, v + 0.09, dz);
    const lit = this.hover === "board";
    poly([corner(0.08, 42), corner(1.87, 42), corner(1.87, 6), corner(0.08, 6)], lit ? "#ffffff" : "#eceee6");
    const notes = ["#b797c9", "#9eb8a8", "#f3c299", "#93b7d5"];
    for (let column = 0; column < 4; column++)
      for (let row = 0; row < 2; row++) {
        const du = 0.2 + column * 0.43;
        const dz = 34 - row * 14;
        poly(
          [corner(du, dz), corner(du + 0.28, dz), corner(du + 0.28, dz - 9), corner(du, dz - 9)],
          notes[(column + row) % notes.length]!,
        );
      }
    const [x, y] = p(u + 0.97, v + 0.09, 24);
    this.hits.push({ id: "board", kind: "zone", x, y, r: 52, ry: 34 });
    const [lx, ly] = p(u + 0.97, v + 0.09, -30);
    if (openOrders !== null) text(`BOARD · ${openOrders} OPEN →`, lx, ly, "bold 11px monospace", lit ? "#ffffff" : "#a9a3b7", "center");
  }
  hit(x: number, y: number): Hit | undefined {
    return this.hits
      .slice()
      .reverse()
      .find(
        (h) =>
          Math.abs(x - h.x) < h.r && Math.abs(y - h.y) < (h.ry ?? h.r * 1.3),
      );
  }
}
const PROBE_SCALE = 4;
let probe: HTMLCanvasElement | null = null;
/** Finds what was painted by reading a quarter-size copy, so cutting forty pieces does not read forty full canvases. */
function cropPainted(source: HTMLCanvasElement): Pick<Piece, "canvas" | "x" | "y"> | null {
  probe ??= document.createElement("canvas");
  probe.width = Math.ceil(source.width / PROBE_SCALE);
  probe.height = Math.ceil(source.height / PROBE_SCALE);
  const reader = probe.getContext("2d", { willReadFrequently: true })!;
  reader.clearRect(0, 0, probe.width, probe.height);
  reader.drawImage(source, 0, 0, probe.width, probe.height);
  const alpha = reader.getImageData(0, 0, probe.width, probe.height).data;
  let left = probe.width, top = probe.height, right = -1, bottom = -1;
  for (let row = 0; row < probe.height; row++)
    for (let column = 0; column < probe.width; column++)
      if (alpha[(row * probe.width + column) * 4 + 3]) {
        left = Math.min(left, column);
        right = Math.max(right, column);
        top = Math.min(top, row);
        bottom = Math.max(bottom, row);
      }
  if (right < 0) return null;
  const x = Math.max(0, (left - 1) * PROBE_SCALE);
  const y = Math.max(0, (top - 1) * PROBE_SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(source.width, (right + 2) * PROBE_SCALE) - x;
  canvas.height = Math.min(source.height, (bottom + 2) * PROBE_SCALE) - y;
  canvas.getContext("2d")!.drawImage(source, -x, -y);
  return { canvas, x, y };
}
export { Office, drawAvatar };
