import type { LayoutId } from "../studio/catalog";
export type StudioZone = "manager" | "design" | "development" | "decisions";
export const officeLayout = {
  width: 1800,
  height: 1062,
  room: { width: 17.5, depth: 13, wallHeight: 150 },
  projection: { x: 610, y: 250, tileWidth: 40, tileHeight: 20 },
  zones: [
    {
      id: "manager",
      name: "Management",
      description: "Manager and vision",
      u: 0.8,
      v: 0.8,
      width: 5.6,
      depth: 4.6,
      color: "#9ebba9",
      icon: "chat",
    },
    {
      id: "design",
      name: "Design and strategy",
      description: "Designer and specialist agents",
      u: 7.4,
      v: 0.8,
      width: 9.3,
      depth: 4.6,
      color: "#b7a7c4",
      icon: "edit",
    },
    {
      id: "development",
      name: "Development",
      description: "Workers in their worktrees",
      u: 0.8,
      v: 6.5,
      width: 8.6,
      depth: 5.7,
      color: "#8dabb9",
      icon: "code",
    },
    {
      id: "decisions",
      name: "Decision desk",
      description: "Questions, doubts and conflicts",
      u: 10.4,
      v: 6.5,
      width: 6.3,
      depth: 5.7,
      color: "#c0a38c",
      icon: "help",
    },
  ] as const,
  seats: [
    { zone: "manager", u: 2.6, v: 2.7 },
    { zone: "design", u: 8.8, v: 2.7 },
    { zone: "design", u: 13.4, v: 2.7 },
    { zone: "development", u: 1.6, v: 8.0 },
    { zone: "development", u: 5.6, v: 8.0 },
    { zone: "development", u: 1.6, v: 10.7 },
    { zone: "development", u: 5.6, v: 10.7 },
    { zone: "decisions", u: 13.6, v: 7.6 },
  ] as const,
};
// How much the room grew past the one the theme decor was drawn for; scenery pinned to the far walls moves by this.
export const roomGrowth = { east: officeLayout.room.width - 14, south: officeLayout.room.depth - 10.4 };
export const DESK = { width: 1.94, depth: 0.88 };
export const DECISION_TABLE = { u: 11.2, v: 10.0, width: 3.5, depth: 2.2 };
/** Where the sign over the decision table hangs: over its far end, clear of the desks beside it. */
export const DECISION_SIGN = { u: DECISION_TABLE.u + 3.2, v: DECISION_TABLE.v + 0.65, z: 130 };
export const COFFEE_COUNTER = { u: 0.65, v: officeLayout.room.depth - 0.8, width: 2.2, depth: 0.55 };
// Canvas pixels from the floor under a chair down to the top of its owner's name, which hangs under the desk in line with them.
export const SEAT_LABEL_DROP = 34;
type Spot = { u: number; v: number };
/**
 * Where things are around a desk. Its owner sits behind it, facing the room, a little to the right so the screens,
 * which stand to the left, never cover a face.
 */
export const seatSpots = (seat: Spot) => ({
  chair: { u: seat.u + 1.15, v: seat.v - 0.42 },
  standsUp: { u: seat.u + 1.15, v: seat.v - 1.0 },
  visitor: { u: seat.u + 0.97, v: seat.v + 1.7 },
  footprint: { u: seat.u - 0.05, v: seat.v - 0.9, width: DESK.width + 0.1, depth: DESK.depth + 0.95 },
});
export type DeskKit = "plain" | "lead" | "dual" | "dev" | "tablet" | "papers";
/** What stands on a desk says whose it is. */
export function deskKit(owner: { role: string; kind: "manager" | "worker" | "advisor" } | undefined): DeskKit {
  if (!owner) return "plain";
  if (owner.kind === "manager") return "lead";
  if (/architect/i.test(owner.role)) return "dual";
  if (/design/i.test(owner.role)) return "tablet";
  if (/review|qa|security|audit/i.test(owner.role)) return "papers";
  return owner.kind === "worker" ? "dev" : "plain";
}
const SCREEN_PLANE = 0.3;
/** The screens of a desk as tile spans along its width; they share one plane and one height. */
export const deskScreens = (seat: Spot, kit: DeskKit): Array<{ u: number; v: number; width: number }> =>
  (kit === "dual" ? [[0, 0.58], [0.62, 0.58]] : kit === "lead" ? [[0.1, 0.95]] : [[0.3, 0.8]]).map(([du, width]) => ({
    u: seat.u + du!,
    v: seat.v + SCREEN_PLANE,
    width: width!,
  }));
type Seat = { zone: StudioZone; u: number; v: number };
export type StudioLayout = {
  zones: Array<{
    id: StudioZone;
    name: string;
    description: string;
    u: number;
    v: number;
    width: number;
    depth: number;
    color: string;
    icon: string;
  }>;
  seats: Seat[];
  denseSeats: Seat[];
  partitions: Array<{
    u: number;
    v: number;
    width: number;
    depth: number;
    height: number;
  }>;
};
const originalPartitions = [
  { u: 6.75, v: 0.35, width: 0.12, depth: 5, height: 66 },
  { u: 0.55, v: 5.9, width: 4.2, depth: 0.12, height: 44 },
  { u: 7.6, v: 5.9, width: 3, depth: 0.12, height: 44 },
  { u: 13.4, v: 5.9, width: 3.4, depth: 0.12, height: 44 },
  { u: 9.8, v: 7.4, width: 0.12, depth: 4.6, height: 36 },
];
const row = (zone: StudioZone, v: number, us: number[]): Seat[] =>
  us.map((u) => ({ zone, u, v }));
// Each row sits 0.4 right of the one behind, so nobody sits straight behind a screen and the front row clears the corner decor.
const denseDevelopment = [
  ...row("development", 7.3, [0.2, 2.8, 5.4]),
  ...row("development", 9.2, [0.6, 3.2, 5.8]),
  ...row("development", 11.1, [1.0, 3.6, 6.2]),
];
const denseDesign = [
  ...row("design", 1.9, [8.4, 12.4]),
  ...row("design", 3.9, [10.0, 14.0]),
];
export const studioLayouts: Record<LayoutId, StudioLayout> = {
  zones: {
    zones: officeLayout.zones.map((z) => ({ ...z })),
    seats: officeLayout.seats.map((s) => ({ ...s })),
    denseSeats: [...denseDevelopment, ...denseDesign],
    partitions: originalPartitions,
  },
  open: {
    zones: officeLayout.zones.map((z) =>
      z.id === "manager"
        ? { ...z, width: 4.8, depth: 4.4 }
        : z.id === "design"
          ? { ...z, u: 6.2, width: 10.5, depth: 4.4 }
          : { ...z, v: 5.6, depth: 6.6 },
    ),
    seats: [
      { zone: "manager", u: 1.8, v: 2.4 },
      { zone: "design", u: 7, v: 2.4 },
      { zone: "design", u: 11.2, v: 2.4 },
      { zone: "development", u: 1.6, v: 7.2 },
      { zone: "development", u: 5.6, v: 7.2 },
      { zone: "development", u: 1.6, v: 10.2 },
      { zone: "development", u: 5.6, v: 10.2 },
      { zone: "decisions", u: 13.6, v: 7.6 },
    ],
    denseSeats: [...denseDevelopment, ...denseDesign],
    partitions: [],
  },
  pods: {
    zones: officeLayout.zones.map((z) =>
      z.id === "manager"
        ? { ...z, u: 11.6, width: 5.1 }
        : z.id === "design"
          ? { ...z, u: 0.8, width: 10 }
          : { ...z },
    ),
    seats: [
      { zone: "manager", u: 12.8, v: 2.7 },
      { zone: "design", u: 1.8, v: 2.7 },
      { zone: "design", u: 6, v: 2.7 },
      { zone: "development", u: 1.6, v: 8.0 },
      { zone: "development", u: 5.6, v: 8.0 },
      { zone: "development", u: 1.6, v: 10.7 },
      { zone: "development", u: 5.6, v: 10.7 },
      { zone: "decisions", u: 13.6, v: 7.6 },
    ],
    denseSeats: [
      ...denseDevelopment,
      ...row("design", 1.9, [1.4, 5.4]),
      ...row("design", 3.9, [3.0, 7.0]),
    ],
    partitions: [
      { u: 11.1, v: 0.35, width: 0.12, depth: 5, height: 66 },
      { u: 0.55, v: 5.9, width: 3, depth: 0.12, height: 40 },
      { u: 5.4, v: 5.9, width: 3.2, depth: 0.12, height: 40 },
      { u: 9.8, v: 7.4, width: 0.12, depth: 4.6, height: 36 },
    ],
  },
};
export const getStudioLayout = (id: LayoutId) => studioLayouts[id];
export const floorPoint = (u: number, v: number, z = 0): [number, number] => [
  Math.round(
    officeLayout.projection.x + (u - v) * officeLayout.projection.tileWidth,
  ),
  Math.round(
    officeLayout.projection.y +
      (u + v) * officeLayout.projection.tileHeight -
      z,
  ),
];

type SeatAgent = {
  id: string;
  role: string;
  kind: "manager" | "worker" | "advisor";
};
const zonesOfKind: Record<SeatAgent["kind"], StudioZone[]> = {
  manager: ["manager"],
  worker: ["development"],
  advisor: ["design", "decisions"],
};

function seatsFor(agents: SeatAgent[], layout: StudioLayout) {
  const crowded = new Set<StudioZone>();
  for (const [kind, zones] of Object.entries(zonesOfKind)) {
    const desks = layout.seats.filter((seat) => zones.includes(seat.zone));
    if (agents.filter((agent) => agent.kind === kind).length > desks.length)
      zones.forEach((zone) => crowded.add(zone));
  }
  return layout.zones.flatMap((zone) => {
    const dense = layout.denseSeats.filter((seat) => seat.zone === zone.id);
    return crowded.has(zone.id) && dense.length
      ? dense
      : layout.seats.filter((seat) => seat.zone === zone.id);
  });
}

// Visual placement only. Roles, permissions and assignments remain backend-owned.
export function assignStudioSeats<T extends SeatAgent>(
  agents: T[],
  layout: StudioLayout = studioLayouts.zones,
) {
  const available = [...agents];
  const seats = seatsFor(agents, layout);
  const placements = seats.map((seat) => {
    const index = available.findIndex((agent) => {
      if (seat.zone === "manager") return agent.kind === "manager";
      if (seat.zone === "development") return agent.kind === "worker";
      if (seat.zone === "design")
        return (
          agent.kind === "advisor" &&
          /design|architect|strateg/i.test(agent.role)
        );
      return agent.kind === "advisor";
    });
    const agent = index >= 0 ? available.splice(index, 1)[0] : undefined;
    return { ...seat, agent };
  });
  for (const seat of placements) {
    if (!seat.agent && seat.zone === "design") {
      const index = available.findIndex((agent) => agent.kind === "advisor");
      if (index >= 0) seat.agent = available.splice(index, 1)[0];
    }
  }
  return placements.filter(
    (placed, index) => placed.agent || layout.seats.includes(seats[index]!),
  );
}
export const unseatedAgents = (
  agents: SeatAgent[],
  layout: StudioLayout = studioLayouts.zones,
) =>
  agents.length -
  assignStudioSeats(agents, layout).filter((seat) => seat.agent).length;
