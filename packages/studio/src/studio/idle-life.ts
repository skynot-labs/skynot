export type Spot = { u: number; v: number };
export type Rect = { u: number; v: number; width: number; depth: number };
export type Floor = { width: number; depth: number; blocked: Rect[] };
// A haunt someone owns (their desk) is for the others to visit, never for its owner.
export type Haunt = Spot & { doing: string; owner?: string };
// null is "at the desk".
export type IdlePose = (Spot & { walking: boolean; doing: string | null; beside?: string }) | null;

const STEP = 0.5;
const CLEARANCE = 0.3;
// Room to stand without a shoulder inside a desk or a face behind a monitor.
const STANDING_ROOM = 0.9;
export const TILES_PER_SECOND = 1.4;
const MIN_LINGER_MS = 5_000;
const MIN_CYCLE_MS = 40_000;
const CYCLE_SPREAD_MS = 40_000;

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
const chance = (seed: string) => hash(seed) / 2 ** 32;

const length = (a: Spot, b: Spot) => Math.hypot(b.u - a.u, b.v - a.v);

function walkable(floor: Floor) {
  const columns = Math.floor(floor.width / STEP) - 1;
  const rows = Math.floor(floor.depth / STEP) - 1;
  const spot = (cell: number): Spot => ({
    u: ((cell % columns) + 1) * STEP,
    v: (Math.floor(cell / columns) + 1) * STEP,
  });
  const clear = (margin: number) =>
    Array.from({ length: columns * rows }, (_, cell) => {
      const { u, v } = spot(cell);
      return !floor.blocked.some(
        (rect) =>
          u > rect.u - margin &&
          u < rect.u + rect.width + margin &&
          v > rect.v - margin &&
          v < rect.v + rect.depth + margin,
      );
    });
  const free = clear(CLEARANCE);
  const roomy = clear(STANDING_ROOM);
  const nearest = (target: Spot, among = free): number | null => {
    let best: number | null = null;
    among.forEach((open, cell) => {
      if (open && (best === null || length(spot(cell), target) < length(spot(best), target))) best = cell;
    });
    return best;
  };
  return { columns, rows, free, roomy, spot, nearest };
}

/**
 * Breadth-first over half tiles, eight directions, never cutting a corner. It ends at the roomy spot nearest to `to`,
 * so nobody stops to stand wedged against furniture. Null when the floor does not connect them.
 */
export function route(floor: Floor, from: Spot, to: Spot): Spot[] | null {
  const { columns, rows, free, roomy, spot, nearest } = walkable(floor);
  const start = nearest(from);
  const goal = nearest(to, roomy) ?? nearest(to);
  if (start === null || goal === null) return null;
  const cameFrom = new Map<number, number>([[start, start]]);
  const queue = [start];
  for (let head = 0; head < queue.length && !cameFrom.has(goal); head++) {
    const cell = queue[head]!;
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nc = column + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
      const next = nr * columns + nc;
      if (!free[next] || cameFrom.has(next)) continue;
      if (dc && dr && (!free[row * columns + nc] || !free[nr * columns + column])) continue;
      cameFrom.set(next, cell);
      queue.push(next);
    }
  }
  if (!cameFrom.has(goal)) return null;
  const path = [goal];
  while (path[0] !== start) path.unshift(cameFrom.get(path[0]!)!);
  return path.map(spot);
}

export function along(path: Spot[], distance: number): Spot {
  let left = distance;
  for (let index = 1; index < path.length; index++) {
    const leg = length(path[index - 1]!, path[index]!);
    if (left <= leg) {
      const share = leg === 0 ? 0 : left / leg;
      return {
        u: path[index - 1]!.u + (path[index]!.u - path[index - 1]!.u) * share,
        v: path[index - 1]!.v + (path[index]!.v - path[index - 1]!.v) * share,
      };
    }
    left -= leg;
  }
  return path.at(-1)!;
}

export function pathLength(path: Spot[]): number {
  let distance = 0;
  for (let index = 1; index < path.length; index++) distance += length(path[index - 1]!, path[index]!);
  return distance;
}

const ELBOW_ROOM = 0.9;
/**
 * Two people on their feet never share a spot: whoever comes later in the list steps aside, away from the other.
 * Each walk is worked out alone, so this is where they notice each other.
 */
export function apart<Pose extends Spot>(standing: Array<Pose | null>): Array<Pose | null> {
  const placed: Pose[] = [];
  return standing.map((pose) => {
    if (!pose) return null;
    let moved = pose;
    for (const other of placed) {
      const gap = length(other, moved);
      if (gap >= ELBOW_ROOM) continue;
      const [du, dv] = gap === 0 ? [1, 0] : [(moved.u - other.u) / gap, (moved.v - other.v) / gap];
      moved = { ...moved, u: other.u + du * ELBOW_ROOM, v: other.v + dv * ELBOW_ROOM };
    }
    placed.push(moved);
    return moved;
  });
}

const routes = new Map<string, Spot[] | null>();
function remembered(key: string, find: () => Spot[] | null): Spot[] | null {
  if (!routes.has(key)) {
    if (routes.size > 300) routes.clear();
    routes.set(key, find());
  }
  return routes.get(key)!;
}

/**
 * Where an agent with nothing in hand is at `timeMs`: at the desk for a while, then a walk to one of the haunts, a stay
 * there, and the walk back. The same id and time always give the same answer, so every redraw agrees without state.
 * A time of zero is a still frame: everyone is at the desk.
 */
export function idlePose(id: string, home: Spot, floor: Floor, haunts: Haunt[], timeMs: number): IdlePose {
  if (timeMs <= 0 || haunts.length === 0) return null;
  const cycleMs = MIN_CYCLE_MS + chance(`${id}:pace`) * CYCLE_SPREAD_MS;
  const clock = timeMs + chance(`${id}:offset`) * cycleMs;
  const cycle = Math.floor(clock / cycleMs);
  const elapsed = clock - cycle * cycleMs;
  const leavesAt = cycleMs * (0.3 + chance(`${id}:${cycle}:desk`) * 0.3);
  if (elapsed < leavesAt) return null;
  const haunt = haunts[Math.floor(chance(`${id}:${cycle}:haunt`) * haunts.length)]!;
  const path = remembered(
    [home.u, home.v, haunt.u, haunt.v, ...floor.blocked.flatMap((rect) => [rect.u, rect.v])].join(","),
    () => route(floor, home, haunt),
  );
  if (!path) return null;
  const distance = pathLength(path);
  const walkMs = (distance / TILES_PER_SECOND) * 1000;
  const lingerMs = cycleMs - leavesAt - 2 * walkMs;
  if (lingerMs < MIN_LINGER_MS) return null;
  const away = elapsed - leavesAt;
  if (away < walkMs) return { ...along(path, (away / 1000) * TILES_PER_SECOND), walking: true, doing: null };
  if (away < walkMs + lingerMs)
    return { ...path.at(-1)!, walking: false, doing: haunt.doing, ...(haunt.owner ? { beside: haunt.owner } : {}) };
  const back = distance - ((away - walkMs - lingerMs) / 1000) * TILES_PER_SECOND;
  return { ...along(path, Math.max(0, back)), walking: true, doing: null };
}
