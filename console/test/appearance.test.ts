import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentAppearance,
  readAppearance,
  writeAppearance,
} from "../src/application/appearance";
import { avatarSchema, resolveAvatar } from "../src/avatars/model";
import { avatarBounds } from "../src/ui/avatar-renderer";
import { config, defaultAvatar } from "../src/config";
import type { Agent } from "../src/contracts";

const plain = {
  skin: "#ecc3a0",
  hair: "#3a293e",
  shirt: "#b5a0ed",
  style: "short" as const,
};
const agent: Agent = {
  id: "developer",
  name: "Developer",
  role: "developer",
  kind: "worker",
  engine: "claude",
  model: null,
  status: "idle",
  orderId: null,
  runId: null,
  queuePosition: null,
  avatar: plain,
};
afterEach(() => vi.unstubAllGlobals());

describe("avatar preferences", () => {
  it("round-trips dimensions, clothes, independent accessories and custom colors by project", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const original = structuredClone(agent);
    const avatar = resolveAvatar({
      ...plain,
      height: 1.2,
      build: 1.5,
      outfit: "jacket",
      pants: "#123abc",
      shoes: "#fedcba",
      eyewear: "round",
      headwear: "beanie",
      audio: "headphones",
      neckwear: "scarf",
      facialHair: "beard",
    });
    writeAppearance({ [`one/${agent.id}`]: { avatar, alias: "Morgan" } });
    const saved = readAppearance();
    expect(saved[`one/${agent.id}`]?.avatar).toEqual(avatar);
    expect(values.has(config.appearanceStorageKey)).toBe(true);
    expect(agentAppearance("one", agent, saved)).toEqual({
      avatar,
      name: "Morgan",
    });
    expect(agentAppearance("two", agent, saved)).toEqual({
      avatar: resolveAvatar(agent.avatar),
      name: "Developer",
    });
    expect(agent).toEqual(original);
  });
  it("rejects invalid proportions and unsupported appearance values before persisting", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    expect(() =>
      writeAppearance({
        "one/worker": { avatar: { ...plain, build: 99 }, alias: "Morgan" },
      }),
    ).toThrow();
    expect(setItem).not.toHaveBeenCalled();
    expect(avatarSchema.safeParse({ ...plain, height: -1 }).success).toBe(
      false,
    );
    expect(avatarSchema.safeParse({ ...plain, pants: "red" }).success).toBe(
      false,
    );
  });
  it("builds a valid default avatar for any team size", () => {
    const avatars = Array.from({ length: 20 }, (_, index) =>
      defaultAvatar(index),
    );
    expect(avatars[7]).toEqual(resolveAvatar(avatars[7]!));
    expect(avatars[1]).not.toEqual(avatars[0]);
  });
  it("gives larger silhouettes room without moving their floor anchor", () => {
    const ordinary = avatarBounds(plain);
    const larger = avatarBounds({
      ...plain,
      height: 1.2,
      build: 1.5,
      headwear: "beanie",
    });
    expect(larger.top).toBeLessThan(ordinary.top);
    expect(larger.right - larger.left).toBeGreaterThan(
      ordinary.right - ordinary.left,
    );
    expect(larger.bottom).toBe(ordinary.bottom);
  });
});
