import { describe, expect, it } from "vitest";
import {
  COFFEE_COUNTER,
  DECISION_SIGN,
  DECISION_TABLE,
  DESK,
  deskScreens,
  roomGrowth,
  SEAT_LABEL_DROP,
  seatSpots,
  type DeskKit,
  assignStudioSeats,
  floorPoint,
  officeLayout,
  studioLayouts,
  unseatedAgents,
  type StudioLayout,
} from "../src/ui/office-layout";
import { Office, SCREEN, SEATED_TOP, type SceneAgent } from "../src/ui/office-renderer";
import { resolveAvatar } from "../src/avatars/model";
import { defaultStudioPreferences } from "../src/studio/model";
import type { LayoutId } from "../src/studio/catalog";

type Kind = "manager" | "worker" | "advisor";
const roster: Array<{ id: string; kind: Kind; role: string }> = (
  [
    ["m", "manager", "Manager"],
    ["w1", "worker", "Developer"],
    ["a1", "advisor", "Reviewer"],
    ["w2", "worker", "Developer"],
    ["a2", "advisor", "Designer"],
    ["w3", "worker", "Developer"],
    ["a3", "advisor", "Architect"],
    ["w4", "worker", "Developer"],
    ["w5", "worker", "Developer"],
    ["a4", "advisor", "Security"],
    ["w6", "worker", "Developer"],
    ["w7", "worker", "Developer"],
    ["a5", "advisor", "Strategist"],
    ["w8", "worker", "Developer"],
    ["w9", "worker", "Developer"],
    ["a6", "advisor", "Reviewer"],
    ["w10", "worker", "Developer"],
    ["w11", "worker", "Developer"],
    ["m2", "manager", "Manager"],
    ["a7", "advisor", "Designer"],
  ] as const
).map(([id, kind, role]) => ({ id, kind, role }));
const team = (size: number) => roster.slice(0, size);
const layouts = Object.entries(studioLayouts) as Array<[LayoutId, StudioLayout]>;
const everyoneSeated = [1, 8, 9, 12, 15];

const seatsBeforeDenseRows: Record<LayoutId, Array<[string, number, number]>> = {
  zones: [
    ["manager", 2.6, 2.7],
    ["design", 8.8, 2.7],
    ["design", 13.4, 2.7],
    ["development", 1.6, 8],
    ["development", 5.6, 8],
    ["development", 1.6, 10.7],
    ["development", 5.6, 10.7],
    ["decisions", 13.6, 7.6],
  ],
  open: [
    ["manager", 1.8, 2.4],
    ["design", 7, 2.4],
    ["design", 11.2, 2.4],
    ["development", 1.6, 7.2],
    ["development", 5.6, 7.2],
    ["development", 1.6, 10.2],
    ["development", 5.6, 10.2],
    ["decisions", 13.6, 7.6],
  ],
  pods: [
    ["manager", 12.8, 2.7],
    ["design", 1.8, 2.7],
    ["design", 6, 2.7],
    ["development", 1.6, 8],
    ["development", 5.6, 8],
    ["development", 1.6, 10.7],
    ["development", 5.6, 10.7],
    ["decisions", 13.6, 7.6],
  ],
};
const occupantsOfEight = ["m", "a2", "a3", "w1", "w2", "w3", "w4", "a1"];

type Rect = { u: number; v: number; width: number; depth: number };
const intersects = (a: Rect, b: Rect) =>
  a.u < b.u + b.width &&
  b.u < a.u + a.width &&
  a.v < b.v + b.depth &&
  b.v < a.v + a.depth;
const footprint = (seat: { u: number; v: number }): Rect[] => [seatSpots(seat).footprint];
const plant = (u: number, v: number): Rect => ({
  u: u - 0.3,
  v: v - 0.3,
  width: 0.6,
  depth: 0.6,
});
const { width: roomWidth, depth: roomDepth } = officeLayout.room;
const props: Record<string, Rect> = {
  bookshelf: { u: 0.6, v: 0.3, width: 1.2, depth: 0.55 },
  counterOrOfrenda: { u: 0.55, v: COFFEE_COUNTER.v - 0.14, width: 2.6, depth: 0.76 },
  treePlanter: { u: 0.35, v: 9.05 + roomGrowth.south, width: 0.4, depth: 0.4 },
  cornerPlanter: { u: 12.6 + roomGrowth.east, v: 0.65, width: 1.05, depth: 0.7 },
  decisionTable: DECISION_TABLE,
  plantByManager: plant(0.65, 3.7),
  plantBackCorner: plant(roomWidth - 1, 0.7),
  plantFrontLeft: plant(0.5, roomDepth - 0.7),
  plantFrontRight: plant(roomWidth - 0.9, roomDepth - 1.6),
};

type Box = { left: number; right: number; top: number; bottom: number };
const overlap = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const chair = (seat: { u: number; v: number }) => {
  const spot = seatSpots(seat).chair;
  return floorPoint(spot.u, spot.v);
};
const around = (
  seat: { u: number; v: number },
  left: number,
  right: number,
  top: number,
  bottom: number,
): Box => {
  const [x, y] = chair(seat);
  return { left: x + left, right: x + right, top: y + top, bottom: y + bottom };
};
// What shows of someone at their desk: the desk's front panel hides them from the chest down.
const avatarBox = (seat: { u: number; v: number }) =>
  around(seat, -25, 26, -SEATED_TOP, -40);
const headBox = (seat: { u: number; v: number }) =>
  around(seat, -25, 26, -SEATED_TOP, -56);
const kits: DeskKit[] = ["plain", "lead", "dual", "dev", "tablet", "papers"];
// The widest any desk's screens reach, whoever owns it.
const monitorBox = (seat: { u: number; v: number }): Box => {
  const corners = kits.flatMap((kit) =>
    deskScreens(seat, kit).flatMap((screen) => [
      floorPoint(screen.u, screen.v, SCREEN.top),
      floorPoint(screen.u + screen.width, screen.v, SCREEN.top),
      floorPoint(screen.u, screen.v, SCREEN.bottom),
      floorPoint(screen.u + screen.width, screen.v, SCREEN.bottom),
    ]),
  );
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
};
const shortNameLabel = (seat: { u: number; v: number }) =>
  around(seat, -30, 30, SEAT_LABEL_DROP, SEAT_LABEL_DROP + 23);
const [signX, signY] = floorPoint(DECISION_SIGN.u, DECISION_SIGN.v, DECISION_SIGN.z);
const decisionBubble: Box = { left: signX - 95, right: signX + 95, top: signY - 27, bottom: signY + 25 };
const paintOrder = (seat: { u: number; v: number }) => seat.u + seat.v;
const isOriginal = (id: LayoutId, seat: { u: number; v: number }) =>
  seatsBeforeDenseRows[id].some(([, u, v]) => u === seat.u && v === seat.v);

describe("studio seats", () => {
  it("keeps the eight original desks and their occupants for a team that fits them", () => {
    for (const [id, layout] of layouts) {
      const alone = assignStudioSeats(team(1), layout);
      const eight = assignStudioSeats(team(8), layout);
      expect(alone.map((s) => [s.zone, s.u, s.v])).toEqual(
        seatsBeforeDenseRows[id],
      );
      expect(alone.map((s) => s.agent?.id ?? null)).toEqual([
        "m",
        ...Array(7).fill(null),
      ]);
      expect(eight.map((s) => [s.zone, s.u, s.v])).toEqual(
        seatsBeforeDenseRows[id],
      );
      expect(eight.map((s) => s.agent?.id)).toEqual(occupantsOfEight);
    }
  });

  it("seats every agent once, in the zone of its kind, up to fifteen", () => {
    for (const [, layout] of layouts)
      for (const size of everyoneSeated) {
        const placed = assignStudioSeats(team(size), layout);
        const seated = placed.filter((seat) => seat.agent);
        expect(seated.map((seat) => seat.agent!.id).sort()).toEqual(
          team(size)
            .map((agent) => agent.id)
            .sort(),
        );
        expect(new Set(placed.map((s) => `${s.u}/${s.v}`)).size).toBe(
          placed.length,
        );
        for (const seat of seated)
          expect(
            {
              manager: ["manager"],
              worker: ["development"],
              advisor: ["design", "decisions"],
            }[seat.agent!.kind],
          ).toContain(seat.zone);
        expect(unseatedAgents(team(size), layout)).toBe(0);
      }
  });

  it("only packs the zone that ran out of desks, and leaves no empty desk in it", () => {
    for (const [id, layout] of layouts) {
      const placed = assignStudioSeats(team(9), layout);
      const development = placed.filter((s) => s.zone === "development");
      expect(development).toHaveLength(5);
      expect(development.every((seat) => seat.agent)).toBe(true);
      expect(
        placed
          .filter((s) => s.zone !== "development")
          .map((s) => [s.zone, s.u, s.v]),
      ).toEqual(seatsBeforeDenseRows[id].filter(([zone]) => zone !== "development"));
    }
  });

  it("reports the agents left without a desk instead of dropping them silently", () => {
    for (const [, layout] of layouts) {
      expect(unseatedAgents(team(16), layout)).toBe(1);
      expect(unseatedAgents(team(20), layout)).toBe(5);
      const placed = assignStudioSeats(team(20), layout);
      const ids = placed.flatMap((seat) => (seat.agent ? [seat.agent.id] : []));
      expect(new Set(ids).size).toBe(15);
      expect(ids).not.toContain("m2");
      expect(ids).not.toContain("w10");
    }
    const workers = roster.filter((agent) => agent.kind === "worker");
    expect(unseatedAgents(workers)).toBe(2);
    expect(
      assignStudioSeats(workers).filter((seat) => seat.agent && seat.zone !== "development"),
    ).toEqual([]);
  });

  it("keeps every desk inside the room and clear of desks, partitions and props", () => {
    for (const [id, layout] of layouts)
      for (const size of [...everyoneSeated, 20]) {
        const placed = assignStudioSeats(team(size), layout);
        for (const seat of placed) {
          expect(seat.u).toBeGreaterThanOrEqual(0);
          expect(seat.v).toBeGreaterThanOrEqual(0);
          expect(seat.u + DESK.width).toBeLessThanOrEqual(officeLayout.room.width);
          expect(seat.v + DESK.depth).toBeLessThanOrEqual(officeLayout.room.depth);
          expect(seatSpots(seat).footprint.v).toBeGreaterThanOrEqual(0);
          const obstacles = [
            ...layout.partitions.map((wall) => ["partition", wall] as const),
            ...Object.entries(props),
            ...placed
              .filter((other) => other !== seat)
              .flatMap((other) =>
                footprint(other).map((rect) => ["desk", rect] as const),
              ),
          ];
          for (const [name, obstacle] of obstacles)
            for (const rect of footprint(seat))
              expect(
                intersects(rect, obstacle),
                `${id}/${size}: desk at ${seat.u},${seat.v} hits ${name} at ${obstacle.u},${obstacle.v}`,
              ).toBe(false);
        }
      }
  });

  it("keeps every face clear of the monitors, avatars and decision bubble painted after it", () => {
    for (const [id, layout] of layouts)
      for (const size of [...everyoneSeated, 20]) {
        const placed = assignStudioSeats(team(size), layout);
        for (const seat of placed.filter((s) => s.agent)) {
          const where = `${id}/${size}: ${seat.agent!.id} at ${seat.u},${seat.v}`;
          if (!isOriginal(id, seat)) {
            expect(overlap(avatarBox(seat), decisionBubble), where).toBe(false);
            expect(overlap(shortNameLabel(seat), decisionBubble), where).toBe(
              false,
            );
          }
          for (const front of placed.filter(
            (other) =>
              paintOrder(other) > paintOrder(seat) &&
              !(isOriginal(id, seat) && isOriginal(id, other)),
          )) {
            const pair = `${where} behind ${front.u},${front.v}`;
            expect(overlap(headBox(seat), monitorBox(front)), pair).toBe(false);
            if (front.agent)
              expect(overlap(headBox(seat), avatarBox(front)), pair).toBe(
                false,
              );
          }
          for (const other of placed.filter(
            (s) => s.agent && s !== seat && !isOriginal(id, s),
          ))
            expect(
              overlap(shortNameLabel(seat), shortNameLabel(other)),
              `${where} label on ${other.u},${other.v}`,
            ).toBe(false);
        }
      }
  });
});

function paintedScene(agents: SceneAgent[], layout: LayoutId) {
  const texts: string[] = [];
  const context = new Proxy(
    { fillText: (text: string) => texts.push(text) },
    {
      get: (target, key) =>
        key in target ? target[key as keyof typeof target] : () => undefined,
      set: () => true,
    },
  );
  const office = new Office({
    getContext: () => context,
  } as unknown as HTMLCanvasElement);
  office.draw({
    name: "Shop",
    accent: "#ffffff",
    paused: false,
    pending: 0,
    openOrders: 0,
    agents,
    settings: { ...defaultStudioPreferences, layout },
  });
  return { office, texts };
}
const sceneAgents = (size: number): SceneAgent[] =>
  team(size).map((agent) => ({
    ...agent,
    name: agent.id,
    bubble: null,
    status: "idle",
    avatar: resolveAvatar({
      skin: "#c98f6b",
      hair: "#3b2a22",
      shirt: "#5b7f95",
      style: "short",
    }),
  }));

describe("studio scene", () => {
  it("answers a click on each seated avatar with that agent", () => {
    for (const [id, layout] of layouts)
      for (const size of [...everyoneSeated, 20]) {
        const { office } = paintedScene(sceneAgents(size), id);
        for (const seat of assignStudioSeats(team(size), layout)) {
          if (!seat.agent) continue;
          const [x, y] = chair(seat);
          expect(office.hit(x, y - 65), `${id}/${size}: ${seat.agent.id}`).toEqual(
            expect.objectContaining({ kind: "agent", id: seat.agent.id }),
          );
        }
      }
  });

  it("paints how many agents have no desk, and nothing when all are seated", () => {
    for (const [id] of layouts) {
      expect(paintedScene(sceneAgents(20), id).texts).toContain(
        "+5 MORE ON THE TEAM",
      );
      expect(paintedScene(sceneAgents(16), id).texts).toContain(
        "+1 MORE ON THE TEAM",
      );
      expect(
        paintedScene(sceneAgents(15), id).texts.filter((text) =>
          text.includes("MORE ON THE TEAM"),
        ),
      ).toEqual([]);
    }
  });
});
