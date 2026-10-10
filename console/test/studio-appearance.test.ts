import { afterEach, describe, expect, it, vi } from "vitest";
import {
  studioAppearanceFrom,
  studioPreference,
  projectStudio,
} from "../src/application/studio-appearance";
import {
  defaultStudioPreferences,
  normalizeStudioPreferences,
} from "../src/studio/model";
import { applyWardrobeLook, ambientAvatar } from "../src/studio/wardrobe";
import { studioAgentAppearance, studioScene } from "../src/studio/presentation";
import {
  studioLayouts,
  assignStudioSeats,
  officeLayout,
} from "../src/ui/office-layout";
import type { Agent, Project } from "../src/contracts";
import { resolveAvatar } from "../src/avatars/model";
import type { Appearance } from "../src/application/appearance";

const member = (id: string, kind: Agent["kind"]): Agent => ({
  id,
  name: id,
  role: id,
  kind,
  engine: "claude",
  model: null,
  status: kind === "worker" ? "working" : "idle",
  orderId: null,
  runId: null,
  queuePosition: null,
  runs: 0,
  spentUsd: 0,
  usage: null,
  avatar: {
    skin: "#ecc3a0",
    hair: "#3a293e",
    shirt: "#b5a0ed",
    style: "short",
  },
});
const agent = member("manager", "manager");
const project: Project = {
  id: "one",
  name: "one",
  description: null,
  repo: "skynot-labs/one",
  accent: "#a5d7b8",
  paused: null,
  reviewing: false,
  workers: ["developer"],
  agents: [agent, member("developer", "worker")],
  orders: [],
  inbox: [],
  chat: [],
  decisions: [],
  teamChanges: [],
  briefingChanges: [],
  briefing: null,
  hireable: [],
  activity: [],
  runs: [],
  answered: [],
  spentUsd: 0,
  tokens: null,
};

afterEach(() => vi.unstubAllGlobals());
describe("project studio presentation preferences", () => {
  it("saves a theme per project without changing another project's view", () => {
    const theme = {
      ...defaultStudioPreferences,
      place: "kyoto" as const,
      season: "spring" as const,
      layout: "open" as const,
    };
    const command = studioPreference("one", theme);
    expect(command).toEqual({
      name: "set-preference",
      payload: { key: "studio/one", value: theme },
    });
    const saved = studioAppearanceFrom({ "studio/one": theme });
    expect(projectStudio(saved, "one")).toEqual(theme);
    expect(projectStudio(saved, "two")).toEqual(defaultStudioPreferences);
    expect(studioPreference("one", null)?.payload).toEqual({
      key: "studio/one",
      value: null,
    });
  });
  it("recovers unknown catalog IDs independently and keeps valid projects", () => {
    const result = studioAppearanceFrom({
      "studio/one": {
        place: "removed-place",
        season: "winter",
        festival: "future-party",
        layout: "pods",
      },
      "studio/two": { place: "coast", season: "summer" },
    });
    expect(result.one).toMatchObject({
      place: "studio",
      season: "winter",
      festival: "none",
      layout: "pods",
    });
    expect(result.two).toMatchObject({ place: "coast", season: "summer" });
    expect(normalizeStudioPreferences(null)).toEqual(defaultStudioPreferences);
  });
  it("reads only studio entries that hold a style", () => {
    expect(
      studioAppearanceFrom({
        "studio/one": "kyoto",
        "studio/two": ["coast"],
        "studio/one/developer": { place: "coast" },
        "avatar/one/developer": { place: "coast" },
        "layout/one": { place: "coast" },
      }),
    ).toEqual({});
  });
  it("rejects unsupported settings and builds no command for a key the shop would refuse", () => {
    expect(() =>
      studioPreference("one", {
        ...defaultStudioPreferences,
        place: "unknown" as "studio",
      }),
    ).toThrow();
    expect(studioPreference("Not A Project", defaultStudioPreferences)).toBeNull();
  });
  it("layers clothes without changing body, identity, optical glasses or audio", () => {
    const base = resolveAvatar({
      ...agent.avatar,
      height: 1.2,
      build: 1.4,
      eyewear: "optical",
      audio: "headphones",
      headwear: "cap",
    });
    const original = structuredClone(base);
    const winter = ambientAvatar(base, {
      ...defaultStudioPreferences,
      season: "winter",
      wardrobe: "ambient",
    });
    expect(winter).toMatchObject({
      height: base.height,
      build: base.build,
      skin: base.skin,
      hair: base.hair,
      eyewear: "optical",
      audio: "headphones",
      headwear: "cap",
      outfit: "sweater",
      neckwear: "scarf",
    });
    expect(base).toEqual(original);
    expect(ambientAvatar(base, defaultStudioPreferences)).toEqual(base);
  });
  it("lets a festival override seasonal clothes and restores the base on opt-out", () => {
    const preferences = {
      ...defaultStudioPreferences,
      season: "winter" as const,
      festival: "halloween" as const,
      wardrobe: "ambient" as const,
    };
    const dressed = studioAgentAppearance(project.id, agent, {}, preferences);
    expect(dressed.avatar.headwear).toBe("witch");
    const saved: Appearance = {
      [`${project.id}/${agent.id}`]: {
        avatar: agent.avatar,
        alias: "Morgan",
        followStudioLook: false,
      },
    };
    const personal = studioAgentAppearance(
      project.id,
      agent,
      saved,
      preferences,
    );
    expect(personal).toEqual({
      name: "Morgan",
      avatar: resolveAvatar(agent.avatar),
    });
    expect(
      studioAgentAppearance("other", agent, saved, preferences).avatar.headwear,
    ).toBe("witch");
  });
  it("keeps workflow status, paused state and agent records outside decoration", () => {
    const original = structuredClone(project);
    const scene = studioScene(
      project,
      {},
      {
        ...defaultStudioPreferences,
        festival: "christmas",
        wardrobe: "ambient",
      },
      true,
    );
    expect(scene.paused).toBe(true);
    expect(scene.agents.map((a) => [a.id, a.status, a.kind, a.role])).toEqual(
      project.agents.map((a) => [a.id, a.status, a.kind, a.role]),
    );
    expect(scene.agents.map((a) => a.avatar.headwear)).toEqual([
      "santa",
      "santa",
    ]);
    expect(project).toEqual(original);
    expect(applyWardrobeLook(agent.avatar, "muertos").headwear).toBe("flowers");
  });
  it("combines regional outfits with seasons and restores personal appearance", () => {
    const avatar = resolveAvatar(agent.avatar);
    const original = structuredClone(avatar);
    for (const [place, outfit] of [
      ["kyoto", "happi"],
      ["coast", "striped"],
      ["cdmx", "embroidered"],
    ] as const) {
      const preferences = {
        ...defaultStudioPreferences,
        place,
        season: "winter" as const,
        wardrobe: "ambient" as const,
      };
      const themed = ambientAvatar(avatar, preferences);
      expect(themed).toMatchObject({
        outfit,
        neckwear: "scarf",
        skin: avatar.skin,
        hair: avatar.hair,
        height: avatar.height,
        build: avatar.build,
        eyewear: avatar.eyewear,
        audio: avatar.audio,
      });
      expect(
        ambientAvatar(avatar, { ...preferences, wardrobe: "personal" }),
      ).toEqual(original);
    }
    expect(avatar).toEqual(original);
  });
  it("treats calavera makeup as reversible costume while keeping optical frames", () => {
    const avatar = resolveAvatar({
      ...agent.avatar,
      eyewear: "optical",
      audio: "headphones",
    });
    const painted = applyWardrobeLook(avatar, "muertos");
    expect(painted).toMatchObject({
      facePaint: "calavera",
      eyewear: "optical",
      audio: "headphones",
      skin: avatar.skin,
    });
    expect(applyWardrobeLook(painted, "coast").facePaint).toBe("none");
    expect(
      ambientAvatar(avatar, {
        ...defaultStudioPreferences,
        place: "kyoto",
        festival: "christmas",
        wardrobe: "ambient",
      }),
    ).toMatchObject({
      outfit: "festive",
      headwear: "santa",
      facePaint: "none",
    });
  });
  it("places each agent at most once and keeps complete desks inside every room", () => {
    const agents = Array.from({ length: 14 }, (_, i) => ({
      id: String(i),
      kind: (i === 0 ? "manager" : i < 10 ? "worker" : "advisor") as
        "manager" | "worker" | "advisor",
      role: i === 10 ? "Designer" : "Engineer",
    }));
    for (const layout of Object.values(studioLayouts)) {
      const placed = assignStudioSeats(agents, layout);
      const ids = placed.flatMap((seat) => (seat.agent ? [seat.agent.id] : []));
      expect(new Set(ids).size).toBe(ids.length);
      expect(placed.find((seat) => seat.zone === "manager")?.agent?.kind).toBe(
        "manager",
      );
      for (const seat of placed) {
        expect(seat.u).toBeGreaterThanOrEqual(0);
        expect(seat.v).toBeGreaterThanOrEqual(0);
        expect(seat.u + 1.94).toBeLessThanOrEqual(officeLayout.room.width);
        expect(seat.v + 2.1).toBeLessThanOrEqual(officeLayout.room.depth);
      }
    }
  });
});
