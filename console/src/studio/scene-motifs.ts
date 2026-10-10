import type { ScenePainter, SceneTheme } from "./scene-decor";

// Large silhouettes establish identity; smaller details support it. Decorations
// share the room projection and never participate in operational hit areas.
type Painter = Omit<ScenePainter, "add">;
function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
function star(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5,
      r = i % 2 ? size * 0.45 : size;
    const px = x + Math.cos(a) * r,
      py = y + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
function foliage(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colors: string[],
  size = 1,
) {
  for (const [dx, dy, r] of [
    [-36, 0, 29],
    [0, -24, 37],
    [34, -4, 32],
    [-9, 16, 33],
    [28, 22, 24],
  ] as const) {
    circle(
      ctx,
      x + dx * size,
      y + dy * size,
      r * size,
      colors[(Math.abs(dx) + r) % colors.length]!,
    );
  }
}
function outdoorTree(painter: Painter, theme: SceneTheme) {
  const { ctx, p, line } = painter,
    [x, y] = p(-1.1, 5.1);
  if (
    theme.preferences.season === "neutral" ||
    theme.preferences.season === "winter"
  )
    return;
  line([x, y + 20], [x + 5, y - 75], "#705c47", 12);
  line([x + 3, y - 47], [x - 30, y - 83], "#705c47", 7);
  line([x + 3, y - 60], [x + 35, y - 97], "#705c47", 7);
  const colors =
    theme.preferences.season === "spring"
      ? ["#fa91c0", "#f9b5d2", "#ed6fa6"]
      : theme.preferences.season === "autumn"
        ? ["#ef6a3d", "#f6b44b", "#db403d"]
        : ["#4ba86b", "#80c76c", "#30775c"];
  foliage(ctx, x, y - 100, colors, 1.2);
}
export function drawStudioSurroundings(painter: Painter, theme: SceneTheme) {
  const { ctx, p, line, poly } = painter;
  if (theme.preferences.place === "coast") {
    for (let i = 0; i < 9; i++) {
      const [x, y] = p(-2.1, 1 + i * 1.1);
      line([x - 64, y + 31], [x + 38, y + 3], "#80d3e344", 5);
      line([x - 42, y + 54], [x + 30, y + 36], "#d9fbf34a", 3);
    }
    const [x, y] = p(-1.9, 8.1);
    poly(
      [
        [x - 36, y],
        [x + 30, y],
        [x + 14, y + 18],
        [x - 21, y + 18],
      ],
      "#f9f2df",
    );
    line([x, y], [x, y - 80], "#cfad7b", 4);
    poly(
      [
        [x - 4, y - 76],
        [x - 4, y - 8],
        [x - 39, y - 8],
      ],
      "#faf9ec",
    );
    poly(
      [
        [x + 4, y - 62],
        [x + 30, y - 10],
        [x + 4, y - 10],
      ],
      "#377cc6",
    );
  }
  if (theme.preferences.place === "kyoto") {
    const a = p(-1.5, 7.3),
      b = p(-1.5, 9.5);
    for (const [x, y] of [a, b]) {
      line([x, y], [x, y - 126], "#db493a", 12);
      line([x - 3, y], [x - 3, y - 126], "#ff7556", 3);
      line([x - 8, y], [x + 9, y], "#4d3b37", 8);
    }
    line([a[0] + 17, a[1] - 137], [b[0] - 18, b[1] - 137], "#3a363c", 11);
    line([a[0] + 18, a[1] - 129], [b[0] - 18, b[1] - 129], "#ed533a", 13);
    line([a[0] + 10, a[1] - 100], [b[0] - 10, b[1] - 100], "#db493a", 9);
    const mid = p(-1.5, 8.4, 112);
    line([mid[0], mid[1] - 9], [mid[0], mid[1] + 20], "#db493a", 8);
  }
  outdoorTree(painter, theme);
  if (theme.preferences.season === "summer") {
    const [x, y] = p(10.9, -1.3, 245);
    circle(ctx, x, y, 38, "#ffd15b");
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      line(
        [x + Math.cos(a) * 49, y + Math.sin(a) * 49],
        [x + Math.cos(a) * 62, y + Math.sin(a) * 62],
        "#ffc359",
        5,
      );
    }
  }
  if (theme.preferences.festival === "halloween") {
    const [x, y] = p(11.8, -0.4, 215);
    circle(ctx, x, y, 40, "#ffd57c");
    circle(ctx, x + 15, y - 9, 35, "#38304c");
  }
  if (theme.preferences.season === "winter") {
    for (let i = 0; i < 50; i++) {
      const x = 45 + ((i * 137) % 1010),
        y = 40 + ((i * 73) % 645);
      ctx.fillStyle = "#e1f4f0a0";
      ctx.fillRect(x - 3, y, 7, 2);
      ctx.fillRect(x, y - 3, 2, 7);
    }
  }
}

export function drawPlaceArchitecture(painter: Painter, theme: SceneTheme) {
  const { p, line, poly } = painter,
    place = theme.preferences.place;
  if (place === "studio") return;
  const band =
    place === "coast" ? "#247cc0" : place === "cdmx" ? "#128f9c" : "#9d5439";
  poly(
    [p(0.04, 0.02, 42), p(0.04, 10.4, 42), p(0.04, 10.4, 7), p(0.04, 0.02, 7)],
    band,
  );
  poly(
    [p(0.02, 0.04, 42), p(14, 0.04, 42), p(14, 0.04, 7), p(0.02, 0.04, 7)],
    band,
  );
  for (let i = 0; i < 14; i++) {
    if (place === "kyoto") {
      if (i % 3 === 0) line(p(i, 0.06, 9), p(i, 0.06, 147), "#76533c", 6);
    } else {
      const u = i + 0.25;
      poly(
        [
          p(u, 0.06, 31),
          p(u + 0.23, 0.06, 37),
          p(u + 0.46, 0.06, 31),
          p(u + 0.23, 0.06, 24),
        ],
        place === "coast" ? "#e6f2ed" : i % 2 ? "#ffd259" : "#e891b7",
      );
      line(p(i, 0.06, 8), p(i, 0.06, 40), "#ffffff44", 1);
    }
  }
  if (place === "kyoto")
    for (let i = 0; i < 5; i++)
      line(p(0.07, i * 2.1, 9), p(0.07, i * 2.1, 147), "#76533c", 6);
}

export function drawWindowIdentity(
  painter: Pick<ScenePainter, "ctx" | "p" | "line" | "poly">,
  v: number,
  theme: SceneTheme,
) {
  const { ctx, p, line, poly } = painter;
  if (theme.preferences.place === "kyoto") {
    for (let j = 0; j <= 4; j++)
      line(
        p(0.09, v + 0.06 + j * 0.33, 120),
        p(0.09, v + 0.06 + j * 0.33, 48),
        "#8c573a",
        3,
      );
    for (let z = 50; z < 121; z += 18)
      line(p(0.09, v + 0.06, z), p(0.09, v + 1.35, z), "#8c573a", 3);
  } else if (theme.preferences.place === "coast") {
    line(p(0.09, v, 46), p(0.09, v, 107), "#286abd", 7);
    line(p(0.09, v + 1.4, 46), p(0.09, v + 1.4, 107), "#286abd", 7);
    const arch = Array.from({ length: 13 }, (_, i) =>
      p(
        0.09,
        v + 0.7 - Math.cos((i * Math.PI) / 12) * 0.7,
        107 + Math.sin((i * Math.PI) / 12) * 20,
      ),
    );
    for (let i = 1; i < arch.length; i++)
      line(arch[i - 1]!, arch[i]!, "#286abd", 7);
    for (let i = 0; i < 6; i++)
      poly(
        [
          p(0.12, v + i * 0.23, 128),
          p(0.12, v + (i + 1) * 0.23, 128),
          p(0.38, v + (i + 1) * 0.23, 119),
          p(0.38, v + i * 0.23, 119),
        ],
        i % 2 ? "#f4f6e8" : "#3588cb",
      );
  } else if (theme.preferences.place === "cdmx") {
    line(p(0.09, v, 46), p(0.09, v, 121), "#e15575", 6);
    line(p(0.09, v + 1.4, 46), p(0.09, v + 1.4, 121), "#e15575", 6);
    line(p(0.09, v, 121), p(0.09, v + 1.4, 121), "#e15575", 6);
  }
  if (theme.preferences.season === "winter") {
    poly(
      [
        p(0.11, v - 0.04, 124),
        p(0.11, v + 1.44, 124),
        p(0.36, v + 1.44, 123),
        p(0.36, v - 0.04, 123),
      ],
      "#f0faff",
    );
    for (const at of [0.15, 0.95])
      poly(
        [
          p(0.15, v + at, 123),
          p(0.15, v + at + 0.12, 123),
          p(0.15, v + at + 0.06, 103),
        ],
        "#daf3ff",
      );
  }
  // Keep canvas text out of artwork motifs: no font or external asset dependency.
  void ctx;
}

function wallPanel(
  painter: Painter,
  u: number,
  label: string,
  background: string,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const { ctx, p } = painter;
  ctx.save();
  ctx.translate(...p(u, 0.12, 137));
  ctx.transform(1, 0.5, 0, 1, 0, 0);
  ctx.fillStyle = "#493c46";
  ctx.fillRect(-4, -4, 86, 119);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 78, 107);
  draw(ctx);
  ctx.fillStyle = "#f3eedb";
  ctx.fillRect(0, 96, 78, 11);
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "#413b48";
  ctx.fillText(label, 39, 104);
  ctx.restore();
}
export function drawPlaceWallArt(painter: Painter, theme: SceneTheme) {
  const place = theme.preferences.place;
  if (place === "kyoto") {
    wallPanel(painter, 7.1, "SAMURAI", "#f6d9a0", (ctx) => {
      circle(ctx, 39, 40, 29, "#df563c");
      ctx.fillStyle = "#313545";
      ctx.fillRect(19, 53, 40, 34);
      ctx.fillRect(25, 29, 28, 23);
      ctx.fillStyle = "#788294";
      ctx.fillRect(30, 36, 18, 17);
      ctx.fillRect(15, 55, 13, 13);
      ctx.fillRect(50, 55, 13, 13);
      ctx.fillStyle = "#f9c34f";
      ctx.fillRect(17, 24, 12, 6);
      ctx.fillRect(49, 24, 12, 6);
      ctx.fillRect(14, 13, 6, 15);
      ctx.fillRect(59, 13, 6, 15);
      ctx.fillRect(35, 22, 9, 10);
      ctx.fillStyle = "#ee634c";
      for (let y = 62; y < 85; y += 8) ctx.fillRect(27, y, 25, 3);
      ctx.fillStyle = "#fff2cb";
      ctx.fillRect(30, 40, 5, 2);
      ctx.fillRect(43, 40, 5, 2);
    });
    wallPanel(painter, 10.4, "ANIME CLUB", "#a997e5", (ctx) => {
      star(ctx, 13, 15, 7, "#ffce73");
      star(ctx, 64, 69, 9, "#f2ddff");
      ctx.fillStyle = "#29497c";
      ctx.fillRect(16, 17, 47, 51);
      ctx.fillRect(12, 36, 9, 39);
      ctx.fillRect(58, 33, 9, 42);
      ctx.fillStyle = "#ffd6b0";
      ctx.fillRect(24, 31, 33, 33);
      ctx.fillStyle = "#497ab4";
      ctx.fillRect(17, 19, 47, 12);
      ctx.fillRect(23, 30, 9, 12);
      ctx.fillRect(50, 26, 12, 19);
      ctx.fillStyle = "#fff8ed";
      ctx.fillRect(28, 42, 10, 11);
      ctx.fillRect(45, 42, 9, 11);
      ctx.fillStyle = "#32344c";
      ctx.fillRect(31, 45, 6, 8);
      ctx.fillRect(47, 45, 6, 8);
      ctx.fillStyle = "#ef93a9";
      ctx.fillRect(26, 55, 8, 3);
      ctx.fillRect(48, 55, 8, 3);
      ctx.fillRect(37, 60, 7, 2);
      ctx.fillStyle = "#f0f3ed";
      ctx.fillRect(23, 70, 35, 23);
      ctx.fillStyle = "#d64f75";
      ctx.fillRect(35, 71, 10, 12);
    });
  } else if (place === "coast") {
    wallPanel(painter, 7.1, "AZULEJOS", "#f3f3df", (ctx) => {
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          const x = 13 + col * 26,
            y = 16 + row * 27;
          ctx.strokeStyle = "#327dcc";
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 11, y - 11, 22, 22);
          circle(ctx, x, y, 7, "#2c73ba");
          circle(ctx, x, y, 3, "#eff5df");
        }
    });
    wallPanel(painter, 10.4, "MARE / MAR", "#71c6dc", (ctx) => {
      circle(ctx, 61, 16, 10, "#ffe09a");
      ctx.fillStyle = "#2877b4";
      ctx.fillRect(0, 69, 78, 27);
      ctx.fillStyle = "#f9edcf";
      ctx.beginPath();
      ctx.moveTo(14, 68);
      ctx.lineTo(68, 68);
      ctx.lineTo(55, 83);
      ctx.lineTo(25, 83);
      ctx.fill();
      ctx.fillStyle = "#f9faf0";
      ctx.beginPath();
      ctx.moveTo(39, 18);
      ctx.lineTo(39, 64);
      ctx.lineTo(13, 64);
      ctx.fill();
      ctx.fillStyle = "#f0745c";
      ctx.beginPath();
      ctx.moveTo(44, 29);
      ctx.lineTo(63, 63);
      ctx.lineTo(44, 63);
      ctx.fill();
    });
  } else if (place === "cdmx") {
    wallPanel(painter, 7.1, "LUCHA LIBRE", "#ffd367", (ctx) => {
      ctx.fillStyle = "#de4e8b";
      ctx.fillRect(16, 12, 47, 63);
      ctx.fillRect(22, 75, 35, 12);
      ctx.fillStyle = "#188a9e";
      ctx.fillRect(23, 19, 33, 56);
      ctx.fillRect(18, 34, 43, 20);
      ctx.fillStyle = "#f8f3dc";
      ctx.fillRect(23, 34, 13, 12);
      ctx.fillRect(43, 34, 13, 12);
      ctx.fillRect(31, 58, 19, 8);
      ctx.fillStyle = "#313245";
      ctx.fillRect(27, 36, 8, 5);
      ctx.fillRect(44, 36, 8, 5);
      ctx.fillRect(35, 59, 11, 5);
      ctx.fillStyle = "#f8cd4e";
      ctx.fillRect(37, 20, 5, 36);
      ctx.fillRect(24, 49, 31, 5);
    });
    wallPanel(painter, 10.4, "AJOLOTE", "#218eaa", (ctx) => {
      ctx.fillStyle = "#f176ac";
      for (const x of [10, 61])
        for (const y of [20, 30, 40]) ctx.fillRect(x, y, 8, 5);
      ctx.fillStyle = "#ffb5cc";
      ctx.fillRect(19, 22, 41, 35);
      ctx.fillRect(28, 55, 23, 33);
      ctx.fillRect(16, 65, 14, 8);
      ctx.fillRect(50, 65, 14, 8);
      ctx.fillStyle = "#433b54";
      ctx.fillRect(27, 33, 4, 5);
      ctx.fillRect(48, 33, 4, 5);
      ctx.fillRect(36, 45, 9, 3);
      ctx.fillStyle = "#e878aa";
      ctx.fillRect(24, 41, 8, 3);
      ctx.fillRect(46, 41, 8, 3);
      circle(ctx, 13, 80, 4, "#79d4d7");
      circle(ctx, 64, 14, 4, "#79d4d7");
    });
  }
}

export const landmarkDecor = {
  summerLounge({ p, ctx, block, add }: ScenePainter) {
    add(24.5, () => {
      block(1.5, 10.8, 1.4, 0.8, 5, "#f6cf68");
      for (let i = 0; i < 5; i++)
        block(1.5 + i * 0.28, 10.8, 0.12, 0.8, 1, "#f7f1d4", 5);
      const [x, y] = p(2.4, 11.3, 15);
      circle(ctx, x, y, 23, "#ed725e");
      circle(ctx, x, y, 14, "#e7f3ed");
      ctx.fillStyle = "#efaa54";
      ctx.fillRect(x + 33, y - 25, 12, 23);
      ctx.fillStyle = "#f4e7ad";
      ctx.fillRect(x + 32, y - 28, 14, 4);
    });
  },
  snowman({ p, ctx, add }: ScenePainter) {
    add(24.8, () => {
      const [x, y] = p(12.7, 10.5, 7);
      circle(ctx, x, y - 20, 26, "#dfedf1");
      circle(ctx, x, y - 52, 21, "#f4f7ed");
      circle(ctx, x, y - 80, 16, "#fffdef");
      ctx.fillStyle = "#263c58";
      ctx.fillRect(x - 17, y - 95, 35, 7);
      ctx.fillRect(x - 10, y - 117, 22, 23);
      ctx.fillStyle = "#e15b61";
      ctx.fillRect(x - 18, y - 64, 36, 8);
      ctx.fillRect(x + 10, y - 60, 8, 27);
      ctx.fillStyle = "#ed974e";
      ctx.fillRect(x, y - 81, 15, 4);
      ctx.fillStyle = "#33485b";
      for (const [dx, dy] of [
        [-6, -85],
        [7, -85],
        [0, -47],
        [0, -32],
        [0, -16],
      ] as const)
        ctx.fillRect(x + dx, y + dy, 4, 4);
    });
  },
  haunted({ p, ctx, line, poly, add }: ScenePainter) {
    // Bats and cobwebs belong to the wall pass, ghosts to the foreground pass.
    for (const u of [1.2, 5.8, 9.5, 12.8]) {
      const [x, y] = p(u, 0.13, 143);
      poly(
        [
          [x - 23, y],
          [x - 14, y - 8],
          [x - 6, y - 2],
          [x, y - 10],
          [x + 6, y - 2],
          [x + 14, y - 8],
          [x + 23, y],
          [x + 10, y + 7],
          [x, y + 3],
          [x - 10, y + 7],
        ],
        "#3b284b",
      );
    }
    for (const v of [0, 10.3]) {
      const origin = p(0.15, v, 149);
      for (let i = 1; i < 5; i++)
        line(
          origin,
          p(0.15, Math.max(0, v - i * 0.3), 149 - i * 12),
          "#e3dbf7",
          2,
        );
      for (let i = 1; i < 4; i++)
        line(
          p(0.15, Math.max(0, v - i * 0.3), 149 - i * 12),
          p(i * 0.4, v, 149 - i * 15),
          "#e3dbf7",
          2,
        );
    }
    add(24.6, () => {
      const [x, y] = p(12.8, 10.5, 40);
      circle(ctx, x, y - 37, 23, "#f5eadc");
      poly(
        [
          [x - 23, y - 36],
          [x + 23, y - 36],
          [x + 29, y + 13],
          [x + 14, y + 4],
          [x, y + 15],
          [x - 13, y + 4],
          [x - 29, y + 13],
        ],
        "#f5eadc",
      );
      ctx.fillStyle = "#4b365c";
      ctx.fillRect(x - 11, y - 42, 7, 11);
      ctx.fillRect(x + 5, y - 42, 7, 11);
      ctx.fillRect(x - 3, y - 24, 7, 9);
    });
  },
  ofrenda({ p, ctx, poly, block, add }: ScenePainter) {
    add(16.5, () => {
      block(0.55, 9.48, 2.6, 0.74, 37, "#a64d74");
      block(0.6, 9.47, 2.4, 0.45, 24, "#df783b", 37);
      block(0.8, 9.46, 1.9, 0.24, 26, "#744c92", 61);
      for (const u of [0.7, 1.5, 2.5]) {
        const [x, y] = p(u, 9.72, 40);
        ctx.fillStyle = "#ffc340";
        for (let i = 0; i < 5; i++)
          circle(
            ctx,
            x + (i - 2) * 5,
            y - (i % 2) * 4,
            7,
            i % 2 ? "#ff932c" : "#ffd147",
          );
      }
      for (const u of [0.7, 2.85]) {
        const [x, y] = p(u, 9.61, 65);
        ctx.fillStyle = "#fff1c2";
        ctx.fillRect(x - 4, y - 18, 8, 20);
        circle(ctx, x, y - 23, 5, "#ffb52e");
      }
      const [x, y] = p(1.72, 9.5, 100);
      ctx.fillStyle = "#fcebd8";
      ctx.fillRect(x - 15, y - 17, 30, 27);
      ctx.fillRect(x - 10, y + 10, 20, 8);
      ctx.fillStyle = "#4c355b";
      ctx.fillRect(x - 10, y - 7, 8, 9);
      ctx.fillRect(x + 3, y - 7, 8, 9);
      ctx.fillRect(x - 2, y + 3, 4, 4);
      for (let i = 0; i < 4; i++) ctx.fillRect(x - 8 + i * 5, y + 10, 2, 6);
      circle(ctx, x, y - 13, 3, "#ec58a0");
      poly(
        [
          p(0.3, 9.2, 115),
          p(3.3, 9.2, 115),
          p(3.3, 9.2, 105),
          p(0.3, 9.2, 105),
        ],
        "#fcb137",
      );
      for (let i = 0; i < 7; i++) {
        const [x, y] = p(0.4 + i * 0.44, 9.18, 112);
        circle(ctx, x, y, 7, i % 2 ? "#fa842c" : "#ffd456");
      }
    });
  },
} satisfies Record<string, (painter: ScenePainter, theme: SceneTheme) => void>;

export { circle, foliage, star };
