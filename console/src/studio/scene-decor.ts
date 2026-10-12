import type { resolveSceneTheme } from "./model";
import type { DecorId } from "./catalog";
import { landmarkDecor, circle, foliage, star } from "./scene-motifs";
import { roomGrowth } from "../ui/office-layout";
type Point = [number, number];
export type ScenePainter = {
  ctx: CanvasRenderingContext2D;
  p: (u: number, v: number, z?: number) => Point;
  poly: (points: Point[], fill: string, stroke?: string) => void;
  line: (a: Point, b: Point, color: string, width?: number) => void;
  block: (
    u: number,
    v: number,
    w: number,
    d: number,
    h: number,
    color: string,
    z?: number,
  ) => void;
  add: (depth: number, draw: () => void) => void;
};
export type SceneTheme = ReturnType<typeof resolveSceneTheme>;
type Theme = SceneTheme;
export function drawWindowLandscape(
  painter: Pick<ScenePainter, "p" | "poly" | "line">,
  v: number,
  index: number,
  theme: Theme,
) {
  const { p, poly, line } = painter,
    { palette, place } = theme;
  if (place.view === "sea") {
    poly(
      [
        p(0.05, v + 0.09, 86),
        p(0.05, v + 1.31, 86),
        p(0.05, v + 1.31, 50),
        p(0.05, v + 0.09, 50),
      ],
      palette.horizon,
    );
    for (let j = 0; j < 3; j++)
      line(
        p(0.06, v + 0.2 + j * 0.1, 61 + j * 6),
        p(0.06, v + 1.15 - j * 0.15, 61 + j * 6),
        "#d8e8db",
        1.5,
      );
  } else if (place.view === "mountains") {
    for (let j = 0; j < 2; j++)
      poly(
        [
          p(0.05 + j * 0.01, v + 0.08, 50),
          p(0.05 + j * 0.01, v + 0.44 + j * 0.3, 100 - j * 15),
          p(0.05 + j * 0.01, v + 1.32, 50),
        ],
        j === 0 ? palette.horizon : palette.foliage,
      );
    if (theme.preferences.season === "winter")
      poly(
        [
          p(0.065, v + 0.31, 84),
          p(0.065, v + 0.44, 100),
          p(0.065, v + 0.59, 83),
        ],
        "#eef1e6",
      );
  } else {
    for (let j = 0; j < 5; j++) {
      const height = 64 + ((index * 7 + j * 13) % 26),
        at = v + 0.12 + j * 0.23;
      poly(
        [
          p(0.05, at, height),
          p(0.05, at + 0.17, height),
          p(0.05, at + 0.17, 50),
          p(0.05, at, 50),
        ],
        place.view === "patio"
          ? ["#bc917f", "#a0b1a0", "#d1b685"][j % 3]!
          : palette.horizon,
      );
    }
  }
}
function garland(painter: ScenePainter, theme: Theme) {
  const { p, poly, line, ctx } = painter;
  const christmas = theme.preferences.festival === "christmas";
  const colors = christmas
    ? ["#ffd460", "#f06868", "#a9efc3"]
    : theme.preferences.festival === "halloween"
      ? ["#ff9d3e", "#c38aee", "#ffdf89"]
      : ["#ffb326", "#ee57a3", "#28c9c3", "#a77de8"];
  for (const wall of ["right", "left"]) {
    const at = (a: number, z: number) =>
      wall === "right" ? p(a, 0.16, z) : p(0.16, a, z);
    const count = wall === "right" ? 13 : 10;
    for (let i = 0; i < count; i++) {
      const u = 0.3 + i * 1.04,
        z = 141 - Math.sin((i / (count - 1)) * Math.PI) * 12;
      if (i)
        line(
          at(u - 1.04, z + 2),
          at(u, z),
          christmas ? "#3a785c" : "#8b695d",
          christmas ? 8 : 2,
        );
      if (christmas) {
        const [x, y] = at(u, z - 6);
        circle(ctx, x, y, 6, colors[i % 3]!);
        if (i % 4 === 0) {
          poly(
            [
              [x, y],
              [x - 13, y - 8],
              [x - 13, y + 7],
            ],
            "#e25d63",
          );
          poly(
            [
              [x, y],
              [x + 13, y - 8],
              [x + 13, y + 7],
            ],
            "#e25d63",
          );
        }
      } else {
        poly(
          [
            at(u, z),
            at(u + 0.68, z),
            at(u + 0.68, z - 27),
            at(u + 0.5, z - 24),
            at(u + 0.34, z - 29),
            at(u + 0.15, z - 24),
            at(u, z - 27),
          ],
          colors[i % colors.length]!,
        );
        if (theme.preferences.festival !== "halloween") {
          const [x, y] = at(u + 0.27, z - 14);
          ctx.fillStyle = "#fff3dfb0";
          ctx.fillRect(x - 3, y - 3, 7, 6);
        }
      }
    }
  }
}
const decor: Record<DecorId, (painter: ScenePainter, theme: Theme) => void> = {
  lanterns({ p, poly, line, ctx }, theme) {
    for (const v of [2.3, 6.0, 9.4]) {
      const [x, y] = p(0.3, v, 135);
      line([x, y - 18], [x, y + 4], theme.palette.trim, 3);
      poly(
        [
          [x - 16, y + 3],
          [x + 15, y + 3],
          [x + 19, y + 16],
          [x + 15, y + 44],
          [x - 16, y + 44],
          [x - 20, y + 16],
        ],
        "#e45143",
      );
      line([x - 15, y + 7], [x + 15, y + 7], "#f7ca78", 3);
      line([x - 15, y + 40], [x + 15, y + 40], "#642f35", 4);
      ctx.fillStyle = "#fff2cf";
      ctx.fillRect(x - 3, y + 14, 6, 21);
      ctx.fillRect(x - 9, y + 21, 19, 4);
      line([x, y + 44], [x, y + 55], "#f3b257", 3);
    }
  },
  bonsai({ p, poly, line, block, add }, theme) {
    add(13.9 + roomGrowth.east, () => {
      block(12.6, 0.65, 0.85, 0.6, 12, "#7b857c");
      const [x, y] = p(13, 0.9, 13);
      line([x, y], [x - 8, y - 28], "#806d5b", 5);
      line([x - 8, y - 28], [x + 6, y - 38], "#806d5b", 4);
      for (const [dx, dy] of [
        [-16, -25],
        [5, -40],
        [18, -29],
      ] as const)
        poly(
          [
            [x + dx - 16, y + dy],
            [x + dx - 9, y + dy - 12],
            [x + dx + 12, y + dy - 10],
            [x + dx + 20, y + dy + 2],
            [x + dx - 12, y + dy + 7],
          ],
          theme.palette.foliage,
        );
    });
  },
  parasol({ p, poly, line, add }, theme) {
    add(10.8 + roomGrowth.south, () => {
      const [x, y] = p(0.8, 9.5);
      line([x, y], [x, y - 130], "#938b77", 4);
      poly(
        [
          [x - 63, y - 89],
          [x - 37, y - 118],
          [x, y - 139],
          [x + 41, y - 113],
          [x + 59, y - 88],
          [x, y - 80],
        ],
        "#f8f1da",
      );
      poly(
        [
          [x, y - 139],
          [x + 41, y - 113],
          [x + 59, y - 88],
          [x, y - 80],
        ],
        theme.palette.horizon,
      );
    });
  },
  cactus({ p, block, add, ctx }, theme) {
    add(13.8 + roomGrowth.east, () => {
      block(12.7, 0.7, 0.65, 0.65, 15, "#b9876d");
      const [x, y] = p(13, 1, 13);
      ctx.fillStyle = theme.palette.foliage;
      ctx.fillRect(x - 5, y - 60, 11, 62);
      ctx.fillRect(x - 21, y - 44, 8, 25);
      ctx.fillRect(x - 18, y - 23, 19, 8);
      ctx.fillRect(x + 12, y - 52, 8, 24);
      ctx.fillRect(x + 3, y - 33, 15, 7);
      ctx.fillStyle = theme.palette.foliageLight;
      ctx.fillRect(x - 3, y - 56, 2, 52);
      ctx.fillRect(x + 15, y - 47, 2, 12);
    });
  },
  blossoms({ p, ctx, line, add }) {
    add(17.8 + roomGrowth.east, () => {
      const [x, y] = p(14.4, 3.4, 15);
      line([x, y], [x, y - 90], "#885a4c", 9);
      line([x, y - 65], [x - 30, y - 103], "#885a4c", 5);
      foliage(ctx, x, y - 115, ["#ff96c5", "#f56ba6", "#ffd1df"], 0.85);
      for (let i = 0; i < 24; i++) {
        const dx = ((i * 23) % 110) - 55,
          dy = ((i * 17) % 70) - 35;
        ctx.fillStyle = i % 2 ? "#fff2ed" : "#e95199";
        ctx.fillRect(x + dx, y - 110 + dy, 5, 5);
      }
    });
    for (let i = 0; i < 36; i++) {
      const [x, y] = p(0.5 + ((i * 1.8) % 13), 9.95 - (i % 4) * 0.14, 2);
      ctx.fillStyle = "#f9a9cb";
      ctx.fillRect(x, y, 8, 4);
    }
  },
  leaves({ p, poly }) {
    for (let i = 0; i < 24; i++) {
      const u = 0.8 + ((i * 1.7) % 12),
        v = 9.9 - (i % 3) * 0.14;
      const [x, y] = p(u, v, 1);
      poly(
        [
          [x, y],
          [x + 7, y - 2],
          [x + 10, y + 2],
          [x + 3, y + 4],
        ],
        i % 2 ? "#f4a738" : "#e0643e",
      );
    }
  },
  snow({ p, poly, ctx }) {
    for (let i = 0; i < 5; i++) {
      const v = 0.6 + i * 1.85;
      poly(
        [
          p(-0.03, v, 123),
          p(-0.03, v + 1.4, 123),
          p(0.08, v + 1.4, 123),
          p(0.08, v, 123),
        ],
        "#e5ebe4",
      );
    }
    for (let i = 0; i < 32; i++) {
      const x = 55 + ((i * 97) % 910),
        y = 80 + ((i * 37) % 630);
      ctx.fillStyle = "#dce6e04a";
      ctx.fillRect(x, y, 3, 3);
    }
  },
  pumpkins({ p, ctx, add }) {
    add(16.4 + roomGrowth.south, () => {
      for (let i = 0; i < 3; i++) {
        const [x, y] = p(0.95 + i * 0.67, 9.65, 44);
        circle(ctx, x, y - 18, 20, i % 2 ? "#f39b2f" : "#e77129");
        ctx.fillStyle = "#ab511f";
        ctx.fillRect(x - 2, y - 33, 4, 30);
        ctx.fillStyle = "#72a267";
        ctx.fillRect(x - 3, y - 44, 6, 10);
        ctx.fillStyle = "#ffed7c";
        ctx.fillRect(x - 11, y - 23, 6, 7);
        ctx.fillRect(x + 6, y - 23, 6, 7);
        ctx.fillRect(x - 8, y - 10, 17, 5);
      }
    });
  },
  tree({ p, poly, block, ctx, add }) {
    add(10.7 + roomGrowth.south, () => {
      const [x, y] = p(0.55, 9.25);
      block(0.35, 9.05, 0.4, 0.4, 18, "#a9794f");
      for (let i = 0; i < 4; i++)
        poly(
          [
            [x, y - 166 + i * 29],
            [x - 24 - i * 11, y - 113 + i * 30],
            [x + 24 + i * 11, y - 113 + i * 30],
          ],
          i % 2 ? "#32825d" : "#4bab70",
        );
      for (let i = 0; i < 16; i++)
        circle(
          ctx,
          x - 39 + ((i * 23) % 79),
          y - 22 - ((i * 19) % 110),
          5,
          i % 3 === 0 ? "#ffe08d" : i % 3 === 1 ? "#ef666c" : "#d6e9f6",
        );
      star(ctx, x, y - 177, 17, "#ffdc67");
    });
    add(16.3 + roomGrowth.south, () => {
      for (const [u, v, c] of [
        [0.8, 9.75, "#e36077"],
        [1.65, 9.75, "#429faf"],
        [2.3, 9.75, "#d4a045"],
      ] as const) {
        block(u, v, 0.6, 0.48, 24, c, 44);
        block(u + 0.24, v, 0.09, 0.48, 2, "#fce2a0", 68);
      }
    });
  },
  garland,
  ...landmarkDecor,
  marigolds({ p, ctx, block, add }) {
    add(14.2 + roomGrowth.east, () => {
      block(12.65, 0.7, 1, 0.5, 14, "#bc8c70");
      for (let i = 0; i < 20; i++) {
        const [x, y] = p(
          12.6 + (i % 5) * 0.18,
          0.8 + Math.floor(i / 5) * 0.1,
          17 + ((i * 7) % 16),
        );
        ctx.fillStyle = i % 2 ? "#ff9d27" : "#ffd454";
        ctx.fillRect(x - 3, y - 3, 7, 7);
        ctx.fillStyle = "#aa8059";
        ctx.fillRect(x, y, 2, 2);
      }
    });
    for (let i = 0; i < 24; i++) {
      const [x, y] = p(8.2 + (i % 7) * 0.62, 9.9 - (i % 3) * 0.14, 1);
      ctx.fillStyle = "#ffa82d";
      ctx.fillRect(x, y, 5, 3);
    }
  },
};
export function drawStudioDecor(painter: ScenePainter, theme: Theme) {
  for (const id of theme.decor) decor[id](painter, theme);
}

export function drawFloorDetail(
  { p, poly, line }: Pick<ScenePainter, "p" | "poly" | "line">,
  u: number,
  v: number,
  edge: number,
  theme: Theme,
) {
  if (theme.place.material === "wood") {
    for (let j = 1; j < 4; j++)
      line(p(u + j * 0.25, v), p(u + j * 0.25, edge), "#a4938733");
  } else if (theme.place.material === "tatami") {
    for (let j = 1; j < 5; j++)
      line(
        p(u, v + (j * (edge - v)) / 5),
        p(u + 1, v + (j * (edge - v)) / 5),
        "#6b765825",
      );
  } else if (theme.place.view === "patio" && (u + v) % 3 === 0) {
    poly(
      [
        p(u + 0.5, v + 0.16, 0.2),
        p(u + 0.83, v + 0.5, 0.2),
        p(u + 0.5, v + 0.84, 0.2),
        p(u + 0.17, v + 0.5, 0.2),
      ],
      theme.palette.horizon + "77",
    );
    poly(
      [
        p(u + 0.5, v + 0.31, 0.3),
        p(u + 0.68, v + 0.5, 0.3),
        p(u + 0.5, v + 0.69, 0.3),
        p(u + 0.32, v + 0.5, 0.3),
      ],
      theme.palette.trim + "99",
    );
  }
}
