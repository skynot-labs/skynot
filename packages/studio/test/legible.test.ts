import { describe, expect, it } from "vitest";
import { arrange, legible, reads, type Box } from "../src/stage/legible";
import { busyDots } from "../src/ui/office-renderer";

const STAGE = 1800;
const bubbleText = 14;
const wholeStage = { left: 0, right: STAGE, top: 0 };
const overlaps = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 && a.y < b.y + b.height && b.y < a.y + a.height;

describe("what the director reads in the office", () => {
  it("grows a bubble until its text is twelve pixels on the screen, at a desktop and at a phone", () => {
    for (const shown of [1159, 900, 502]) {
      const ratio = shown / STAGE;
      expect(bubbleText * legible(bubbleText, ratio) * ratio).toBeCloseTo(12);
    }
  });

  it("leaves text alone where the screen already shows it large enough, and before the stage has a size", () => {
    expect(legible(bubbleText, 1)).toBe(1);
    expect(legible(bubbleText, 0.64 * 3)).toBe(1);
    expect(legible(bubbleText, 0)).toBe(1);
  });

  it("stops showing a name tag once it would be a smudge", () => {
    expect(reads(12, 1159 / STAGE)).toBe(true);
    expect(reads(12, 502 / STAGE)).toBe(false);
  });

  it("holds the dots over a working agent whole while time stands still, and counts them up while it runs", () => {
    expect(busyDots(0)).toBe("···");
    expect([0, 1, 2, 3].map((step) => busyDots(1 + step * 300).trim())).toEqual(["·", "··", "···", "·"]);
    expect(new Set([1, 301, 601].map((time) => busyDots(time).length))).toEqual(new Set([3]));
  });
});

describe("the labels over the office", () => {
  it("leaves alone the ones that are clear of each other and inside the screen", () => {
    const apart: Box[] = [
      { x: 400, y: 300, width: 140, height: 40 },
      { x: 900, y: 300, width: 140, height: 40 },
    ];
    expect(arrange(apart, wholeStage, 4)).toEqual(apart);
  });

  it("lifts the one behind clear of the one in front of it, which keeps its place", () => {
    const front = { x: 500, y: 320, width: 180, height: 40 };
    const behind = { x: 560, y: 300, width: 180, height: 40 };
    const [movedBehind, keptFront] = arrange([behind, front], wholeStage, 4);
    expect(keptFront).toEqual(front);
    expect(movedBehind).toEqual({ ...behind, y: 276 });
    expect(overlaps(movedBehind!, keptFront!)).toBe(false);
  });

  it("clears a whole row of neighbours, however many crowd together", () => {
    const crowd: Box[] = Array.from({ length: 5 }, (_, index) => ({ x: 600 + index * 30, y: 500 - index * 3, width: 200, height: 40 }));
    const arranged = arrange(crowd, wholeStage, 4);
    for (const [index, box] of arranged.entries())
      for (const other of arranged.slice(index + 1)) expect(overlaps(box, other)).toBe(false);
    expect(arranged.map((box) => box.x)).toEqual(crowd.map((box) => box.x));
  });

  it("clears neighbours whose sizes are not whole pixels, as they are on a phone", () => {
    const grown = 12 / (14 * (457 / STAGE));
    const crowd: Box[] = Array.from({ length: 6 }, (_, index) => ({
      x: 500.3 + index * 41.7,
      y: 520.9 - index * 7.3,
      width: 120.8 * grown,
      height: 31 * grown,
    }));
    const arranged = arrange(crowd, { left: 4, right: 1396, top: -5000 }, 4 * grown);
    for (const [index, box] of arranged.entries())
      for (const other of arranged.slice(index + 1)) expect(overlaps(box, other)).toBe(false);
  });

  it("keeps a label inside the part of the stage the screen shows", () => {
    const shown = { left: 4, right: 1396, top: 4 };
    const [left, right, high] = arrange(
      [
        { x: 30, y: 400, width: 300, height: 90 },
        { x: 1500, y: 600, width: 300, height: 90 },
        { x: 700, y: -20, width: 300, height: 90 },
      ],
      shown,
      4,
    );
    expect(left!.x - 150).toBe(4);
    expect(right!.x + 150).toBe(1396);
    expect(high!.y).toBe(4);
  });

  it("does not push a label out of the top of the screen to clear another", () => {
    const front = { x: 500, y: 30, width: 180, height: 40 };
    const behind = { x: 520, y: 20, width: 180, height: 40 };
    expect(arrange([behind, front], wholeStage, 4)[0]!.y).toBe(20);
  });
});
