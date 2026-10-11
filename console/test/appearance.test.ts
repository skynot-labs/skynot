import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentAppearance,
  appearanceFrom,
  avatarPreference,
  localPreferencesToUpload,
  uploadLocalPreferences,
} from "../src/application/appearance";
import { studioStorageKey } from "../src/application/studio-appearance";
import { defaultStudioPreferences } from "../src/studio/model";
import { avatarSchema, resolveAvatar } from "../src/avatars/model";
import { avatarBounds } from "../src/ui/avatar-renderer";
import { config, defaultAvatar } from "../src/config";
import type { Agent, Command } from "../src/contracts";

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
  runs: 0,
  spentUsd: 0,
  usage: null,
  soul: null,
  avatar: plain,
};

function browserStorage(initial: Record<string, unknown> = {}) {
  const values = new Map(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}
const keysOf = (commands: Command[]) =>
  commands.map((command) =>
    command.name === "set-preference" ? command.payload.key : command.name,
  );
const dressed = resolveAvatar(plain);
afterEach(() => vi.unstubAllGlobals());

describe("avatar preferences", () => {
  it("reads dimensions, clothes, accessories and custom colors from the shop's preferences, by project", () => {
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
    const command = avatarPreference("one", agent.id, {
      avatar,
      alias: "Morgan",
    });
    if (!command) throw new Error("the key was refused");
    const saved = appearanceFrom({
      [command.payload.key]: command.payload.value,
    });
    expect(command.payload.key).toBe("avatar/one/developer");
    expect(saved["one/developer"]?.avatar).toEqual(avatar);
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
  it("keeps valid avatar entries, drops invalid ones and ignores every other key", () => {
    const valid = { avatar: dressed, alias: "Morgan", followStudioLook: false };
    const saved = appearanceFrom({
      "avatar/one/backend_dev": valid,
      "avatar/one/ui-designer": { avatar: { ...dressed, build: 99 }, alias: "" },
      "avatar/one/manager": "not an object",
      "avatar/one": valid,
      "studio/one": { place: "kyoto" },
      "layout/one/developer": valid,
    });
    expect(saved).toEqual({ "one/backend_dev": valid });
  });
  it("builds the command that saves or removes one agent's avatar", () => {
    expect(
      avatarPreference("one", "backend_dev", { avatar: plain, alias: "Bo" }),
    ).toEqual({
      name: "set-preference",
      payload: {
        key: "avatar/one/backend_dev",
        value: { avatar: dressed, alias: "Bo" },
      },
    });
    expect(avatarPreference("one", "ui-designer", null)).toEqual({
      name: "set-preference",
      payload: { key: "avatar/one/ui-designer", value: null },
    });
  });
  it("builds no command for a key the shop would refuse, and rejects unsupported values", () => {
    const value = { avatar: plain, alias: "Morgan" };
    expect(avatarPreference("one", "QA Lead", value)).toBeNull();
    expect(avatarPreference("one", "dev/ops", value)).toBeNull();
    expect(avatarPreference("One", "developer", value)).toBeNull();
    expect(() =>
      avatarPreference("one", "developer", {
        avatar: { ...plain, build: 99 },
        alias: "Morgan",
      }),
    ).toThrow();
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

describe("preferences styled in this browser before the shop kept them", () => {
  const morgan = { avatar: dressed, alias: "Morgan" };
  const kyoto = { ...defaultStudioPreferences, place: "kyoto" as const };

  it("uploads the local avatars and studio styles the shop does not have", () => {
    browserStorage({
      [config.appearanceStorageKey]: { "one/developer": morgan },
      [studioStorageKey]: { one: kyoto },
    });
    expect(localPreferencesToUpload({})).toEqual([
      {
        name: "set-preference",
        payload: { key: "avatar/one/developer", value: morgan },
      },
      { name: "set-preference", payload: { key: "studio/one", value: kyoto } },
    ]);
  });
  it("never overwrites a key the shop already has", () => {
    browserStorage({
      [config.appearanceStorageKey]: {
        "one/developer": morgan,
        "one/manager": morgan,
      },
      [studioStorageKey]: { one: kyoto, two: kyoto },
    });
    const commands = localPreferencesToUpload({
      "avatar/one/developer": { avatar: plain, alias: "Shared" },
      "studio/one": defaultStudioPreferences,
    });
    expect(keysOf(commands)).toEqual(["avatar/one/manager", "studio/two"]);
  });
  it("skips local entries the shop could not store", () => {
    browserStorage({
      [config.appearanceStorageKey]: {
        "one/QA Lead": morgan,
        developer: morgan,
      },
      [studioStorageKey]: { "Not A Project": kyoto },
    });
    expect(localPreferencesToUpload({})).toEqual([]);
  });
  it("uploads nothing when nothing is local or the browser has no storage", () => {
    browserStorage();
    expect(localPreferencesToUpload({})).toEqual([]);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("disabled");
      },
    });
    expect(localPreferencesToUpload({})).toEqual([]);
  });
  it("stops reading the local copy once the upload went through", async () => {
    const values = browserStorage({
      [config.appearanceStorageKey]: { "one/developer": morgan },
      [studioStorageKey]: { one: kyoto },
    });
    const sent: Command[] = [];
    const count = await uploadLocalPreferences({}, async (command) => {
      sent.push(command);
    });
    expect(count).toBe(2);
    expect(keysOf(sent)).toEqual(["avatar/one/developer", "studio/one"]);
    expect(values.size).toBe(0);
    expect(localPreferencesToUpload({})).toEqual([]);
  });
  it("keeps the local copy when the shop refuses the upload", async () => {
    const values = browserStorage({
      [config.appearanceStorageKey]: { "one/developer": morgan },
    });
    await expect(
      uploadLocalPreferences({}, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(values.has(config.appearanceStorageKey)).toBe(true);
    expect(keysOf(localPreferencesToUpload({}))).toEqual([
      "avatar/one/developer",
    ]);
  });
});
