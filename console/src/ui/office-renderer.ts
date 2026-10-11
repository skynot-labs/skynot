import {
  drawPixelAvatar as avatar,
  drawAvatar,
  avatarBounds,
} from "./avatar-renderer";
import {
  officeLayout,
  assignStudioSeats,
  getStudioLayout,
  floorPoint,
} from "./office-layout";

import {
  normalizeStudioPreferences,
  resolveSceneTheme,
  type StudioPreferences,
} from "../studio/model";
import type { AgentStatus, Avatar } from "../contracts";
import { idlePose, type Floor, type Haunt } from "../studio/idle-life";
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
};
export type SceneState = {
  name: string;
  accent: string;
  paused: boolean;
  agents: SceneAgent[];
  pending: number;
  openOrders: number;
  settings?: StudioPreferences;
};
type BubbleTone = "ask" | "alert" | "done" | "busy" | "wait";
const BUBBLE_FILL: Record<BubbleTone, string> = {
  ask: "#f3c299",
  alert: "#eba9ad",
  done: "#b4debf",
  busy: "#d2c3ed",
  wait: "#c9c6d4",
};
const BUBBLE_STEP_MS = 300;
const WALK_STEP_MS = 200;
// Canvas pixels from the top of a standing avatar's sprite to its soles, at the office scale.
const AVATAR_FEET = 86;
const DECISION_TABLE = { u: 8.7, v: 7.85, width: 3.5, depth: 2.15 };
const COFFEE_COUNTER = { u: 0.65, v: 9.6, width: 2.2, depth: 0.55 };
const HAUNTS: Haunt[] = [
  { u: 3.3, v: 9.9, doing: "coffee" },
  { u: 0.5, v: 3.2, doing: "looking outside" },
  { u: 0.5, v: 7.0, doing: "looking outside" },
  { u: 9.5, v: 0.7, doing: "reading the wall" },
  { u: 5.0, v: 5.0, doing: "stretching" },
  { u: 7.3, v: 9.6, doing: "thinking" },
];
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
  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
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
    const monitor = (
      u: number,
      v: number,
      active: boolean,
      upgraded = false,
    ) => {
      block(u + 0.27, v + 0.15, 0.28, 0.13, 2, "#667886", 47);
      block(u + 0.38, v + 0.17, 0.08, 0.07, 13, "#697986", 49);
      const y = 64,
        h = upgraded ? 32 : 28,
        w = upgraded ? 0.9 : 0.75;
      poly(
        [p(u, v, y + h), p(u + w, v, y + h), p(u + w, v, y), p(u, v, y)],
        "#283647",
      );
      poly(
        [
          p(u + 0.045, v - 0.015, y + h - 3),
          p(u + w - 0.045, v - 0.015, y + h - 3),
          p(u + w - 0.045, v - 0.015, y + 4),
          p(u + 0.045, v - 0.015, y + 4),
        ],
        active ? "#91b8bd" : "#607e8e",
      );
      for (let j = 0; j < 5; j++) {
        const z = y + h - 9 - j * 3;
        line(
          p(u + 0.12, v - 0.025, z),
          p(u + 0.12 + (j % 2 ? 0.3 : 0.43), v - 0.025, z),
          j % 2 ? "#d2debd" : "#596f91",
          1.6,
        );
      }
      line(
        p(u + 0.075, v - 0.03, y + 5),
        p(u + w - 0.075, v - 0.03, y + 5),
        "#e1d2d5",
        1,
      );
    };
    ctx.fillStyle = palette.backdrop;
    ctx.fillRect(0, 0, W, H);
    for (let row = 0; row < 18; row++) {
      for (let col = 0; col < 26; col++) {
        ctx.fillStyle = "#8e83951b";
        ctx.fillRect(24 + col * 57 + (row % 2 ? 28 : 0), 28 + row * 45, 2, 2);
      }
    }
    drawStudioSurroundings({ ctx, p, poly, line, block }, theme);
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
    drawPlaceArchitecture({ ctx, p, poly, line, block }, theme);
    for (let i = 0; i < 5; i++) {
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
      wallBoard(7.1, "IDEAS / DESIGN", "#767486");
      wallBoard(10.4, "VISION / SCOPE", "#718980");
    } else drawPlaceWallArt({ ctx, p, poly, line, block }, theme);
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
    const objects: Array<{ depth: number; fn: () => void }> = [],
      labels: Array<() => void> = [];
    const add = (depth: number, fn: () => void) => {
      objects.push({ depth, fn });
    };
    const partition = (
      u: number,
      v: number,
      w: number,
      d: number,
      height = 42,
    ) => {
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
      });
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
      add(13.8, () => plant(13.0, 0.7, 1.05));
    if (
      !theme.decor.some((id) =>
        ["parasol", "tree", "pumpkins", "ofrenda"].includes(id),
      )
    )
      add(10.5, () => plant(0.5, 9.7, 1.1));
    add(21.9, () => plant(13.1, 8.8, 1.1));
    if (!theme.decor.includes("ofrenda"))
      add(16.0, () => {
        block(0.65, 9.6, 2.2, 0.55, 40, "#c8b49b");
        block(0.65, 9.6, 2.2, 0.55, 4, "#ecdac0", 40);
        block(0.9, 9.67, 0.33, 0.32, 25, "#647581", 44);
        block(1.55, 9.68, 0.19, 0.2, 10, "#b79172", 44);
        block(1.88, 9.68, 0.17, 0.17, 8, "#f0e0c6", 44);
      });
    drawStudioDecor({ ctx, p, poly, line, block, add }, theme);
    const seats = assignStudioSeats(state.agents, layout);
    const floor: Floor = {
      width: officeLayout.room.width,
      depth: officeLayout.room.depth,
      blocked: [
        ...seats.map((seat) => ({ u: seat.u, v: seat.v, width: 1.94, depth: 1.5 })),
        ...layout.partitions,
        DECISION_TABLE,
        COFFEE_COUNTER,
      ],
    };
    const tag = (
      member: SceneAgent,
      x: number,
      top: number,
      bottom: number,
      labelTop: number,
      doing: string | null,
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
      else if (doing)
        labels.push(() => {
          const width = doing.length * 6 + 12;
          ctx.fillStyle = "#f4f1e6d9";
          ctx.fillRect(x + 3 - width / 2, top - 24, width, 15);
          text(doing, x + 3, top - 13, "10px monospace", "#5a6170", "center");
        });
      labels.push(() => {
        const name = member.name.slice(0, 17),
          width = Math.max(60, name.length * 7 + 16);
        ctx.fillStyle = "#31363fe8";
        ctx.fillRect(x - width / 2, labelTop, width, 23);
        text(
          name,
          x,
          labelTop + 16,
          "12px monospace",
          member.status === "working" ? "#d2c3ed" : "#d7e6d8",
          "center",
        );
      });
    };
    for (const { u, v, agent: member, zone } of seats) {
      const active = member?.status === "working";
      const pose =
        member?.status === "idle" && !state.paused
          ? idlePose(
              member.id,
              { u: u + 0.9, v: v + 1.75 },
              floor,
              [
                ...HAUNTS,
                ...seats
                  .filter((seat) => seat.agent && seat.agent.id !== member.id)
                  .map((seat) => ({ u: seat.u + 2.3, v: seat.v + 0.9, doing: `with ${seat.agent!.name.slice(0, 12)}` })),
              ],
              time,
            )
          : null;
      add(u + v + 1, () => {
        const [x, y] = p(u + 0.9, v + 1.1);
        line([x, y - 17], [x, y + 9], "#484957", 3);
        line([x - 14, y + 7], [x + 14, y + 7], "#484957", 3);
        poly(
          [
            [x - 18, y - 76],
            [x + 13, y - 76],
            [x + 13, y - 20],
            [x - 18, y - 20],
          ],
          zone === "manager" ? "#617e70" : "#677488",
        );
        if (member && !pose)
          avatar(
            ctx,
            member.avatar,
            x - 25,
            y - 122,
            3.2,
            true,
            active ? Math.floor(time / 500) % 2 : 0,
          );
        for (const [du, dv] of [
          [0.1, 0.1],
          [1.7, 0.1],
          [0.1, 0.68],
          [1.7, 0.68],
        ] as const)
          block(u + du, v + dv, 0.08, 0.09, 43, "#8a7b70");
        block(
          u,
          v,
          1.94,
          0.88,
          5,
          zone === "manager" ? color(palette.wood, -12) : palette.wood,
          43,
        );
        monitor(u + 0.5, v + 0.25, active, true);
        block(u + 0.45, v + 0.72, 0.69, 0.15, 2, "#e5d6c4", 49);
        for (let k = 0; k < 5; k++)
          line(
            p(u + 0.5 + k * 0.12, v + 0.73, 51),
            p(u + 0.5 + k * 0.12, v + 0.84, 51),
            "#9c95a5",
          );
        block(u + 1.55, v + 0.43, 0.14, 0.14, 9, "#eedcc0", 49);
        block(
          u + 0.13,
          v + 0.47,
          0.19,
          0.2,
          2,
          zone === "design" ? "#b797c9" : "#9eb8a8",
          49,
        );
        if (member && !pose) {
          const top = y - 122 + avatarBounds(member.avatar).top * 3.2;
          tag(member, x, top, y - 31, y + 15, null);
        } else if (!member) {
          labels.push(() =>
            text("OPEN SEAT", x, y + 30, "10px monospace", "#615969", "center"),
          );
        }
      });
      if (member && pose)
        add(pose.u + pose.v - 0.4, () => {
          const [x, y] = p(pose.u, pose.v);
          const stride = pose.walking ? 1 + (Math.floor(time / WALK_STEP_MS) % 2) : 0;
          ctx.fillStyle = "#00000024";
          ctx.beginPath();
          ctx.ellipse(x, y, 17, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          const lift = AVATAR_FEET + (stride === 1 ? 2 : 0);
          avatar(ctx, member.avatar, x - 25, y - lift, 3.2, false, stride);
          tag(member, x, y - lift + avatarBounds(member.avatar).top * 3.2, y + 2, y + 9, pose.doing);
        });
    }
    // A shared decision table belongs to the director, not to a worker run.
    add(19.0, () => {
      block(8.7, 7.85, 3.5, 1.4, 5, "#bd9a81", 41);
      for (const [u, v] of [
        [8.85, 8],
        [11.95, 8],
        [8.85, 9.1],
        [11.95, 9.1],
      ] as const)
        block(u, v, 0.12, 0.12, 41, "#88776c");
      for (const [u, v] of [
        [9.0, 9.45],
        [10.3, 9.45],
        [11.55, 9.45],
      ] as const) {
        block(u, v, 0.6, 0.52, 21, "#83918d");
        block(u, v + 0.47, 0.6, 0.09, 30, "#92a49b");
      }
      block(9.1, 8.3, 0.45, 0.42, 2, "#d7c7e2", 47);
      block(10.0, 8.1, 0.6, 0.42, 2, "#e6ddc3", 47);
      block(11.25, 8.4, 0.2, 0.2, 8, "#c2e1c7", 47);
      const [x, y] = p(10.3, 8.5, 140);
      this.hits.unshift({ id: "decisions", kind: "zone", x, y: y + 12, r: 70 });
      labels.push(() => {
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
    });
    objects.sort((a, b) => a.depth - b.depth).forEach((object) => object.fn());
    labels.forEach((drawLabel) => drawLabel());
    const unseated =
      state.agents.length - seats.filter((seat) => seat.agent).length;
    block(5.25, rd + 0.08, 2.8, 0.35, 9, "#898293", -18);
    block(5.45, rd + 0.48, 2.4, 0.3, 6, "#716b83", -27);
    this.drawBoard(state.openOrders, rd, { p, block, poly, text });
    const [tx, ty] = p(6.5, rd + 1.1, -29);
    text(
      "YOUR VISION. THEIR WORK.",
      tx,
      ty + 22,
      "12px monospace",
      "#898397",
      "center",
    );
    if (unseated > 0) {
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
    openOrders: number,
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
    text(`BOARD · ${openOrders} OPEN →`, lx, ly, "bold 11px monospace", lit ? "#ffffff" : "#a9a3b7", "center");
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
export { Office, drawAvatar };
