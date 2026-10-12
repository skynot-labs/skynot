/** A label in the stage's own pixels: `x` is its middle, `y` its top edge. */
export type Box = { x: number; y: number; width: number; height: number };
export type Bounds = { left: number; right: number; top: number };

const LEGIBLE_PX = 12;
const FAINTEST_PX = 5;

/** How much text of `size` has to grow to read on a screen that shows the stage at `ratio` of its own size. */
export function legible(size: number, ratio: number): number {
  return ratio > 0 ? Math.max(1, LEGIBLE_PX / (size * ratio)) : 1;
}

/** Text left at its own size is worth showing only while it is more than a smudge. */
export function reads(size: number, ratio: number): boolean {
  return size * ratio >= FAINTEST_PX;
}

const overlap = (a: Box, b: Box, gap: number) =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/**
 * Keeps labels inside what the screen shows and off each other. The one nearest the viewer keeps its place; one
 * behind it rises until it is clear, and stays put only when there is no room left above.
 */
export function arrange(boxes: Box[], bounds: Bounds, gap: number): Box[] {
  const placed: Box[] = [];
  const arranged = [...boxes];
  const nearestFirst = boxes.map((_, index) => index).sort((a, b) => boxes[b]!.y - boxes[a]!.y);
  for (const index of nearestFirst) {
    const box = boxes[index]!;
    const half = box.width / 2;
    let moved = {
      ...box,
      x: Math.max(bounds.left + half, Math.min(bounds.right - half, box.x)),
      y: Math.max(bounds.top, box.y),
    };
    // Each label already placed can be in the way once; rounding must not make one of them count twice, forever.
    for (let lifts = 0; lifts < placed.length; lifts++) {
      const inTheWay = placed.find((other) => overlap(moved, other, gap));
      const above = inTheWay ? Math.floor(inTheWay.y - moved.height - gap) : moved.y;
      if (above >= moved.y || above < bounds.top) break;
      moved = { ...moved, y: above };
    }
    placed.push(moved);
    arranged[index] = moved;
  }
  return arranged;
}
