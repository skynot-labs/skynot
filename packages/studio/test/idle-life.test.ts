import { describe, expect, it } from "vitest";
import { apart, idlePose, route, type Floor, type Haunt } from "../src/studio/idle-life";

const desk = { u: 4, v: 4, width: 2, depth: 1.5 };
const floor: Floor = { width: 14, depth: 10, blocked: [desk] };
const home = { u: 5, v: 5.8 };
const haunts: Haunt[] = [
  { u: 5, v: 2.5, doing: "coffee" },
  { u: 11, v: 8, doing: "looking outside" },
];
const inside = (spot: { u: number; v: number }, rect: typeof desk) =>
  spot.u > rect.u && spot.u < rect.u + rect.width && spot.v > rect.v && spot.v < rect.v + rect.depth;
const everySecond = (minutes: number) => Array.from({ length: minutes * 60 }, (_, second) => (second + 1) * 1000);

describe("an idle agent's life in the studio", () => {
  it("walks around furniture instead of through it", () => {
    const path = route(floor, home, haunts[0]!)!;
    expect(path.at(-1)).toEqual({ u: 5, v: 2.5 });
    expect(path.some((spot) => inside(spot, desk))).toBe(false);
    expect(path.length).toBeGreaterThan(7);
  });

  it("stops where there is room to stand, not wedged against the furniture it was sent to", () => {
    const beside = { u: 6.2, v: 4.5 };
    const end = route(floor, home, beside)!.at(-1)!;
    const gap = Math.max(desk.u - end.u, end.u - (desk.u + desk.width), desk.v - end.v, end.v - (desk.v + desk.depth));
    expect(gap).toBeGreaterThanOrEqual(0.9);
    expect(Math.hypot(end.u - beside.u, end.v - beside.v)).toBeLessThan(1.5);
  });

  it("finds no way to a spot the floor does not connect", () => {
    const wall = { u: 7, v: 0, width: 0.5, depth: 10 };
    expect(route({ ...floor, blocked: [desk, wall] }, home, { u: 11, v: 8 })).toBeNull();
  });

  it("leaves the desk, does something somewhere and comes back", () => {
    const poses = everySecond(5).map((time) => idlePose("developer", home, floor, haunts, time));
    const doing = new Set(poses.flatMap((pose) => (pose?.doing ? [pose.doing] : [])));
    expect(poses.some((pose) => pose === null)).toBe(true);
    expect(poses.some((pose) => pose?.walking)).toBe(true);
    expect(doing.size).toBeGreaterThan(0);
    expect([...doing].every((what) => haunts.some((haunt) => haunt.doing === what))).toBe(true);
    expect(poses.some((pose) => pose && inside(pose, desk))).toBe(false);
  });

  it("never jumps: each second it is at most a short walk from the second before", () => {
    const spots = everySecond(5).map((time) => idlePose("architect", home, floor, haunts, time) ?? home);
    const jumps = spots.slice(1).map((spot, index) => Math.hypot(spot.u - spots[index]!.u, spot.v - spots[index]!.v));
    expect(Math.max(...jumps)).toBeLessThan(2);
  });

  it("answers the same for the same agent and time, and differently for another agent", () => {
    const at = (id: string) => everySecond(5).map((time) => JSON.stringify(idlePose(id, home, floor, haunts, time)));
    expect(at("developer")).toEqual(at("developer"));
    expect(at("developer")).not.toEqual(at("reviewer"));
  });

  it("keeps two people on their feet from sharing a spot, and leaves alone whoever is seated or far", () => {
    const here = { u: 5, v: 5, doing: "coffee" };
    const [first, seated, second, near, far] = apart([here, null, { ...here }, { u: 5.3, v: 5, doing: null }, { u: 9, v: 9, doing: null }]);
    const gap = (a: { u: number; v: number }, b: { u: number; v: number }) => Math.hypot(a.u - b.u, a.v - b.v);
    expect(first).toEqual(here);
    expect(seated).toBeNull();
    expect(far).toEqual({ u: 9, v: 9, doing: null });
    expect(gap(first!, second!)).toBeCloseTo(0.9);
    expect(gap(first!, near!)).toBeGreaterThanOrEqual(0.9);
    expect(second!.doing).toBe("coffee");
  });

  it("stays at the desk in a still frame and when there is nowhere to go", () => {
    expect(idlePose("developer", home, floor, haunts, 0)).toBeNull();
    expect(everySecond(3).every((time) => idlePose("developer", home, floor, [], time) === null)).toBe(true);
  });
});
