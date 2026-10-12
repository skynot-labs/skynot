import type { Page } from "@playwright/test";
import { floorPoint, officeLayout } from "../src/ui/office-layout";
import { closeDialog, dialog, expect, openProject, openView, test } from "./support";

declare global {
  interface Window {
    officeDraws: number;
    glows: Array<{ on: string; duration: unknown; animation: Animation }>;
  }
}

const BOARD = floorPoint(2.57, officeLayout.room.depth + 0.64, 24);
const FLOOR_UNDER_THE_BOARD = floorPoint(2.57, officeLayout.room.depth + 1.1);
const EMPTY_CORNER: [number, number] = [40, 40];

function countDraws() {
  window.officeDraws = 0;
  for (const context of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype])
    for (const call of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"] as const) {
      if (!(call in context)) continue;
      const draw: (...args: unknown[]) => unknown = Reflect.get(context, call);
      Reflect.set(context, call, function (this: unknown, ...args: unknown[]) {
        window.officeDraws++;
        return draw.apply(this, args);
      });
    }
}

function recordGlows() {
  window.glows = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = animate.call(this, keyframes, options);
    window.glows.push({ on: this.className, duration: typeof options === "object" ? options.duration : options, animation });
    return animation;
  };
}

// Snow falls for as long as the office is alive, whatever the team is doing; the shop's own state is left alone.
async function snowIn(page: Page, project: string): Promise<void> {
  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, preferences: { ...state.preferences, [`studio/${project}`]: { season: "winter" } } } });
  });
}

const stage = (page: Page) => page.locator(".office-stage canvas");

async function liveOffice(page: Page, project: string): Promise<void> {
  await openProject(page, project);
  await expect(page.locator(".studio-canvas-room.live")).toBeVisible();
  await page.mouse.move(2, 2);
}

async function at(page: Page, [x, y]: [number, number]): Promise<[number, number]> {
  const box = (await stage(page).boundingBox())!;
  const scale = box.width / officeLayout.width;
  return [box.x + x * scale, box.y + y * scale];
}

async function frames(page: Page, count: number, apartMs: number): Promise<string[]> {
  const shots: string[] = [];
  for (let index = 0; index < count; index++) {
    if (index > 0) await page.waitForTimeout(apartMs);
    shots.push((await stage(page).screenshot()).toString("base64"));
  }
  return shots;
}

// A screenshot of a canvas can take seconds on a busy machine, so what is polled for gets more than one look.
const PATIENT = { timeout: 20_000 };
const moves = async (page: Page) => new Set(await frames(page, 2, 700)).size > 1;

async function drawsIn(page: Page, ms: number): Promise<number> {
  const before = await page.evaluate(() => window.officeDraws);
  await page.waitForTimeout(ms);
  return (await page.evaluate(() => window.officeDraws)) - before;
}

test.describe("an office that is alive", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the director holds the office still and wakes it, and the browser remembers which", async ({ page }) => {
    test.slow();
    await page.addInitScript(countDraws);
    await snowIn(page, "alpha");
    await liveOffice(page, "alpha");
    const hold = page.getByRole("button", { name: "Hold the office still" });
    await expect(hold).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => moves(page), PATIENT).toBe(true);

    await hold.click();
    await expect(hold).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(2, 2);
    await expect.poll(() => moves(page), PATIENT).toBe(false);
    expect(await drawsIn(page, 1000)).toBe(0);

    await liveOffice(page, "alpha");
    await expect(hold).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => moves(page), PATIENT).toBe(false);

    await hold.click();
    await expect(hold).toHaveAttribute("aria-pressed", "false");
    await page.mouse.move(2, 2);
    await expect.poll(() => moves(page), PATIENT).toBe(true);
  });

  test("asking the system for less motion while the office is open stills it, and taking that back wakes it", async ({ page }) => {
    test.slow();
    await page.addInitScript(countDraws);
    await snowIn(page, "alpha");
    await liveOffice(page, "alpha");
    await expect.poll(() => moves(page), PATIENT).toBe(true);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => moves(page), PATIENT).toBe(false);
    expect(await drawsIn(page, 1000)).toBe(0);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(() => moves(page), PATIENT).toBe(true);
  });

  test("the light under what can be opened holds steady while the office lives around it", async ({ page }) => {
    test.slow();
    await liveOffice(page, "alpha");
    const [x, y] = await at(page, FLOOR_UNDER_THE_BOARD);
    const light = async () => (await page.screenshot({ clip: { x: x - 4, y: y - 2, width: 8, height: 4 } })).toString("base64");
    const seen = new Set<string>();
    for (let sample = 0; sample < 4; sample++) {
      seen.add(await light());
      await page.waitForTimeout(500);
    }
    expect(seen.size).toBe(1);

    await page.mouse.move(...(await at(page, BOARD)));
    await expect.poll(light, PATIENT).not.toBe([...seen][0]);
  });
});

test.describe("an office held still", () => {
  test("draws nothing on its own, and still answers the pointer and the camera", async ({ page }) => {
    test.slow();
    await page.addInitScript(countDraws);
    await liveOffice(page, "alpha");
    await expect.poll(() => moves(page), PATIENT).toBe(false);
    expect(await drawsIn(page, 1500)).toBe(0);
    const [rest] = await frames(page, 1, 0);

    await page.mouse.move(...(await at(page, BOARD)));
    await expect.poll(async () => (await frames(page, 1, 0))[0], PATIENT).not.toBe(rest);
    await page.mouse.move(2, 2);
    await expect.poll(async () => (await frames(page, 1, 0))[0], PATIENT).toBe(rest);

    const corner = await at(page, EMPTY_CORNER);
    await page.mouse.move(...corner);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -400);
    await page.keyboard.up("Control");
    await expect.poll(async () => (await frames(page, 1, 0))[0], PATIENT).not.toBe(rest);
    await page.mouse.dblclick(...corner);
    await page.mouse.move(2, 2);
    expect((await frames(page, 1, 0))[0]).toBe(rest);
    expect(await drawsIn(page, 1000)).toBe(0);
  });
});

test.describe("around the office", () => {
  test("a dock card asked for while it is open lights its edge, with less motion asked for too, and a dialog opens without a glow", async ({ page }) => {
    await page.addInitScript(recordGlows);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openProject(page, "alpha");
    await openView(page, "Activity");
    await expect(dialog(page).getByRole("heading", { name: "What happened." })).toBeVisible();
    await closeDialog(page);
    expect(await page.evaluate(() => window.glows.length)).toBe(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await openView(page, "Decisions");
    await expect.poll(() => page.evaluate(() => window.glows.map((glow) => [glow.on, glow.duration]))).toEqual([["director-inbox ", 600]]);
    const edge = await page.evaluate(() => {
      const [glow] = window.glows;
      glow!.animation.pause();
      glow!.animation.currentTime = 0;
      return getComputedStyle(document.querySelector(".director-inbox:not(.collapsed)")!).boxShadow;
    });
    expect(edge).toContain("rgb(147, 183, 213)");
  });

  test("says it is reconnecting over the office while the event stream is down, and stops when it is back", async ({ page }) => {
    await liveOffice(page, "alpha");
    const hero = page.getByRole("region", { name: "alpha studio" });
    await expect(page.locator(".main-footer").getByText("LIVE", { exact: true })).toBeVisible();
    await expect(hero.getByText("Reconnecting…")).toHaveCount(0);

    let restore = () => {};
    const down = new Promise<void>((resolve) => (restore = resolve));
    await page.route("**/api/events*", async (route) => {
      await down;
      await route.continue();
    });
    await liveOffice(page, "alpha");
    await expect(hero.getByText("Reconnecting…")).toBeVisible();
    await expect(page.locator(".main-footer").getByText("RECONNECTING", { exact: true })).toBeVisible();

    restore();
    await expect(hero.getByText("Reconnecting…")).toHaveCount(0);
  });
});
