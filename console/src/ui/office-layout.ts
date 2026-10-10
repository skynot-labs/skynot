import type { LayoutId } from "../studio/catalog";
export type StudioZone = "manager" | "design" | "development" | "decisions";
export const officeLayout = {
  width: 1440,
  height: 850,
  room: { width: 14, depth: 10.4, wallHeight: 150 },
  projection: { x: 500, y: 192, tileWidth: 40, tileHeight: 20 },
  zones: [
    {
      id: "manager",
      name: "Management",
      description: "Manager and vision",
      u: 0.7,
      v: 0.65,
      width: 4.7,
      depth: 3.7,
      color: "#9ebba9",
      icon: "chat",
    },
    {
      id: "design",
      name: "Design and strategy",
      description: "Designer and specialist agents",
      u: 6.1,
      v: 0.65,
      width: 7.1,
      depth: 3.7,
      color: "#b7a7c4",
      icon: "edit",
    },
    {
      id: "development",
      name: "Development",
      description: "Workers in their worktrees",
      u: 0.7,
      v: 5.25,
      width: 6.9,
      depth: 4.6,
      color: "#8dabb9",
      icon: "code",
    },
    {
      id: "decisions",
      name: "Decision desk",
      description: "Questions, doubts and conflicts",
      u: 8.2,
      v: 5.25,
      width: 5.0,
      depth: 4.6,
      color: "#c0a38c",
      icon: "help",
    },
  ] as const,
  seats: [
    { zone: "manager", u: 2.0, v: 1.65 },
    { zone: "design", u: 7.0, v: 1.65 },
    { zone: "design", u: 10.3, v: 1.65 },
    { zone: "development", u: 1.3, v: 5.45 },
    { zone: "development", u: 4.5, v: 5.45 },
    { zone: "development", u: 1.3, v: 7.9 },
    { zone: "development", u: 4.5, v: 7.9 },
    { zone: "decisions", u: 10.7, v: 5.45 },
  ] as const,
};

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
  { u: 5.7, v: 0.35, width: 0.12, depth: 4, height: 66 },
  { u: 0.55, v: 4.55, width: 3.2, depth: 0.12, height: 44 },
  { u: 6.2, v: 4.55, width: 2.4, depth: 0.12, height: 44 },
  { u: 10.8, v: 4.55, width: 2.4, depth: 0.12, height: 44 },
  { u: 7.9, v: 6, width: 0.12, depth: 3.8, height: 36 },
];
const row = (zone: StudioZone, v: number, us: number[]): Seat[] =>
  us.map((u) => ({ zone, u, v }));
// Each row sits 0.45 left of the one behind, so a front monitor lands between the avatars behind it.
const denseDevelopment = [
  ...row("development", 4.8, [1.2, 3.55, 5.9]),
  ...row("development", 6.4, [0.75, 3.1, 5.45]),
  ...row("development", 8.0, [0.3, 2.65, 5.0]),
];
// Kept right of the decision bubble and off the screen column above the decision seat.
const denseDesign = [
  ...row("design", 0.9, [7.6, 9.95]),
  ...row("design", 2.5, [9.5, 11.85]),
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
        ? { ...z, width: 3.7 }
        : z.id === "design"
          ? { ...z, u: 4.9, width: 8.3 }
          : { ...z, v: 4.3, depth: 5.55 },
    ),
    seats: [
      { zone: "manager", u: 1.2, v: 1.2 },
      { zone: "design", u: 5, v: 1.2 },
      { zone: "design", u: 8.3, v: 1.2 },
      { zone: "development", u: 1.3, v: 4.7 },
      { zone: "development", u: 4.5, v: 4.7 },
      { zone: "development", u: 1.3, v: 7.3 },
      { zone: "development", u: 4.5, v: 7.3 },
      { zone: "decisions", u: 10.7, v: 5.45 },
    ],
    denseSeats: [...denseDevelopment, ...denseDesign],
    partitions: [],
  },
  pods: {
    zones: officeLayout.zones.map((z) =>
      z.id === "manager"
        ? { ...z, u: 9.3, width: 4 }
        : z.id === "design"
          ? { ...z, u: 0.7, width: 8 }
          : { ...z },
    ),
    seats: [
      { zone: "manager", u: 10, v: 1.65 },
      { zone: "design", u: 1.3, v: 1.65 },
      { zone: "design", u: 4.7, v: 1.65 },
      { zone: "development", u: 1.3, v: 5.45 },
      { zone: "development", u: 4.5, v: 5.45 },
      { zone: "development", u: 1.3, v: 7.9 },
      { zone: "development", u: 4.5, v: 7.9 },
      { zone: "decisions", u: 10.7, v: 5.45 },
    ],
    denseSeats: [
      ...denseDevelopment,
      ...row("design", 0.9, [1.45, 3.8]),
      ...row("design", 2.5, [1.0, 3.3]),
    ],
    partitions: [
      { u: 9, v: 0.35, width: 0.12, depth: 4, height: 66 },
      { u: 0.55, v: 4.55, width: 2.3, depth: 0.12, height: 40 },
      { u: 4.3, v: 4.55, width: 2.5, depth: 0.12, height: 40 },
      { u: 7.9, v: 6, width: 0.12, depth: 3.8, height: 36 },
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
