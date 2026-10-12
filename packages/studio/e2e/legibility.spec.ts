import type { Locator, Page } from "@playwright/test";
import { CONTRACT, type State } from "@skynot/contract";
import { LOCAL_OFFICE, PAIRING_SECRET, SESSION_OFFICE } from "./offices";
import { STAGED_AT, closeDialog, dialog, expect, openDecisionDesk, openManagerChat, openProject, openView, stageState, stagedOrder, test } from "./support";

const PROJECT = "beta";
const AT = STAGED_AT;
const CAPTION = 12;
const HIT = 24;
const READABLE = 4.5;
const RING_PIXELS = 300;
const PAUSE = { since: AT, reason: "paused by the director" };
const STATE_LABELS =
  ".status-chip, .project-paused, .pill.state, .nav-counter, .inbox-counter, .inbox-tabs button span, .studio-zone-nav b, .studio-pause-controls button, .studio-pause-label, .question-meta, .main-footer > span:last-child";

const pairingLink = `${LOCAL_OFFICE}/#office=${encodeURIComponent(SESSION_OFFICE)}&secret=${PAIRING_SECRET}`;
const desk = (page: Page) => page.getByRole("region", { name: "Decision desk" });
const roster = (page: Page) => page.getByRole("region", { name: "Project team" });

// The simulated shop is never paused with a question, a blocked order and work to sign all at once: every state is staged on the way to the studio, and the shop itself is left as it was.
function everyState(state: State): State {
  if (state.project.id !== PROJECT) return state;
  return {
    ...state,
    projects: state.projects.map((project) => (project.id === PROJECT ? { ...project, paused: true, questions: 2, awaitingSignature: 1, blocked: 1, needsYou: 4 } : project)),
    orders: [
      stagedOrder("WO-901", "awaiting_signature"),
      stagedOrder("WO-902", "on_bench", { working: true, signedAt: AT, worker: "developer", question: "Which footer?", questionAt: AT }),
      stagedOrder("WO-903", "in_review", { signedAt: AT, blocked: "the checks failed three times" }),
    ],
    inbox: [
      { id: "question-1", kind: "worker_question", from: "developer", question: "Which footer?", options: ["Left", "Right"], orderId: "WO-902", ticket: null, askedAt: AT },
      { id: "question-2", kind: "ticket_doubt", from: "manager", question: "Is the ticket in scope?", options: [], orderId: null, ticket: 7, askedAt: AT },
    ],
    teamChanges: [{ id: "change-1", action: "hire", role: "designer", reason: "The footer needs an eye.", focus: null, status: "pending", proposedAt: AT }],
    briefingChanges: [{ id: "briefing-1", projectId: PROJECT, text: "Invoices first.", reason: "The director said so.", status: "pending", proposedAt: AT }],
    presence: { working: [{ runId: "run-902", role: "developer", engine: "claude", orderId: "WO-902", since: AT }], waiting: [] },
    paused: PAUSE,
    projectPaused: PAUSE,
    readiness: [],
    activity: [
      { sequence: 2, at: AT, orderId: "WO-902", projectId: PROJECT, role: "developer", by: "developer", kind: "run", text: "The developer started on the footer.", url: null },
      { sequence: 1, at: AT, orderId: null, projectId: PROJECT, role: null, by: "director", kind: "order", text: "The director signed the first order.", url: null },
    ],
  };
}

async function openStagedStudio(page: Page): Promise<void> {
  await stageState(page, (state) => void Object.assign(state, everyState(state)));
  await openProject(page, PROJECT);
  await openDecisionDesk(page);
}

async function typeSizes(labels: Locator): Promise<{ label: string; px: number }[]> {
  await expect(labels.first()).toBeVisible();
  return labels.evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({ label: `${element.className}: ${element.textContent}`, px: Number.parseFloat(getComputedStyle(element).fontSize) })),
  );
}

async function expectCaptionOrLarger(labels: Locator): Promise<void> {
  expect((await typeSizes(labels)).filter((label) => label.px < CAPTION)).toEqual([]);
}

async function expectHittable(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const box = (await control.boundingBox())!;
  expect({ width: box.width >= HIT, height: box.height >= HIT }, `${await control.innerText()} is ${box.width}×${box.height}`).toEqual({ width: true, height: true });
}

// Runs in the page. WCAG 2.x relative luminance, with every translucent layer under the text flattened down to the first opaque one.
function contrasts(elements: Element[], pseudo: string | null): { text: string; ratio: number }[] {
  type Colour = { r: number; g: number; b: number; a: number };
  const read = (value: string): Colour => {
    const [r = 0, g = 0, b = 0, a = 1] = (value.match(/[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
    const scale = value.startsWith("color(") ? 255 : 1;
    return { r: r * scale, g: g * scale, b: b * scale, a };
  };
  const over = (top: Colour, under: Colour): Colour => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const backdrop = (element: Element): Colour => {
    const layers: Colour[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const layer = read(getComputedStyle(node).backgroundColor);
      if (layer.a > 0) layers.push(layer);
      if (layer.a === 1) break;
    }
    return layers.reduceRight((under, top) => over(top, under), read(getComputedStyle(document.body).backgroundColor));
  };
  const opacity = (element: Element): number => {
    let total = 1;
    for (let node: Element | null = element; node; node = node.parentElement) total *= Number(getComputedStyle(node).opacity);
    return total;
  };
  const channel = (value: number) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  const luminance = (colour: Colour) => 0.2126 * channel(colour.r) + 0.7152 * channel(colour.g) + 0.0722 * channel(colour.b);
  return elements
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => {
      const behind = backdrop(element);
      const ink = read(getComputedStyle(element, pseudo).color);
      const [lighter = 0, darker = 0] = [luminance(over({ ...ink, a: ink.a * opacity(element) }, behind)), luminance(behind)].sort((a, b) => b - a);
      return { text: `${element.className} ${element.textContent}`.trim(), ratio: (lighter + 0.05) / (darker + 0.05) };
    });
}

async function expectReadable(texts: Locator, pseudo: string | null = null): Promise<void> {
  await expect(texts.first()).toBeVisible();
  const pairs = await texts.evaluateAll(contrasts, pseudo);
  expect(pairs.length).toBeGreaterThan(0);
  expect(pairs.filter((pair) => pair.ratio < READABLE)).toEqual([]);
}

async function focusRing(page: Page): Promise<{ colour: string; product: string; style: string }> {
  return page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.color = "var(--sk-focus)";
    const product = getComputedStyle(probe).color;
    probe.remove();
    const focused = getComputedStyle(document.activeElement ?? document.body);
    return { colour: focused.outlineColor, product, style: focused.outlineStyle };
  });
}

async function expectProductRing(page: Page): Promise<void> {
  const ring = await focusRing(page);
  expect(ring.product).toMatch(/^rgb/);
  expect({ colour: ring.colour, style: ring.style }).toEqual({ colour: ring.product, style: "solid" });
}

// Runs in the page, which can read a PNG without a library: both shots are of one box, so they compare pixel for pixel.
async function changedPixels(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(
    async (shots) => {
      const [first = new Uint8ClampedArray(), second = new Uint8ClampedArray()] = await Promise.all(
        shots.map(async (png) => {
          const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (byte) => byte.charCodeAt(0))], { type: "image/png" }));
          const context = new OffscreenCanvas(image.width, image.height).getContext("2d");
          context?.drawImage(image, 0, 0);
          return context?.getImageData(0, 0, image.width, image.height).data;
        }),
      );
      const noticeable = 60;
      let changed = 0;
      for (let at = 0; at < first.length; at += 4) {
        const distance = Math.abs(first[at]! - second[at]!) + Math.abs(first[at + 1]! - second[at + 1]!) + Math.abs(first[at + 2]! - second[at + 2]!);
        if (distance > noticeable) changed += 1;
      }
      return first.length === second.length ? changed : -1;
    },
    [before.toString("base64"), after.toString("base64")],
  );
}

async function expectVisibleRing(control: Locator): Promise<void> {
  const page = control.page();
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const unfocused = await control.screenshot();
  await control.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  const changed = await changedPixels(page, unfocused, await control.screenshot());
  expect(changed, `${await control.getAttribute("aria-label") ?? (await control.innerText())}: ${changed} pixels changed`).toBeGreaterThanOrEqual(RING_PIXELS);
}

for (const width of [1440, 390]) {
  test(`at ${width}px a state is said in type no smaller than the caption, and no label leaves its row`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openStagedStudio(page);

    await expect(roster(page).locator(".status-chip").first()).toBeVisible();
    await expect(page.getByRole("complementary").getByText("PAUSED")).toBeVisible();
    await expectCaptionOrLarger(page.locator(STATE_LABELS));
    const switchTo = page.getByRole("complementary").getByRole("button", { name: PROJECT });
    await expect(switchTo).toHaveAccessibleName(/4 waiting for you/);
    await expect(switchTo).not.toContainText("WAITING");
    expect(await typeSizes(switchTo.getByRole("img", { name: "4 waiting for you" }))).toEqual([{ label: "nav-counter: 4", px: CAPTION }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await openView(page, "Work orders");
    const cards = dialog(page).getByRole("button", { name: /WO-90\d/ });
    await expect(cards).toHaveCount(3);
    await expectCaptionOrLarger(dialog(page).locator(".status-chip"));
    for (const card of await cards.all()) {
      const [chip, frame] = [(await card.locator(".status-chip").boundingBox())!, (await card.boundingBox())!];
      expect(chip.x).toBeGreaterThanOrEqual(frame.x);
      expect(chip.x + chip.width).toBeLessThanOrEqual(frame.x + frame.width);
    }

    await cards.filter({ hasText: "WO-902" }).click();
    await expect(dialog(page).getByText("On the bench · working")).toBeVisible();
    await expectCaptionOrLarger(dialog(page).locator(".status-chip"));
    await closeDialog(page);
    await closeDialog(page);

    await openView(page, "Context");
    await expect(dialog(page).getByText("PAUSED", { exact: true })).toBeVisible();
    await expectCaptionOrLarger(dialog(page).locator(STATE_LABELS));
    await closeDialog(page);

    await roster(page).getByRole("button", { name: "developer" }).click();
    await expectCaptionOrLarger(dialog(page).locator(".status-chip"));
  });
}

test("the small controls leave at least 24 by 24 to hit", async ({ page, browserErrors }) => {
  await openStagedStudio(page);

  await expectHittable(page.getByRole("status").filter({ hasText: "SIMULATED ENGINES" }).getByRole("button", { name: "Dismiss this notice" }));
  await expectHittable(page.getByRole("complementary").getByRole("button", { name: "Register a project" }));
  await expectHittable(page.getByRole("button", { name: "All work orders" }));
  await expectHittable(desk(page).getByRole("button", { name: "WO-902", exact: true }));
  await desk(page).getByRole("group", { name: "Waiting for you" }).getByRole("button", { name: "To sign" }).click();
  await expectHittable(desk(page).getByRole("button", { name: "Open detail" }).first());
  await expectHittable(desk(page).getByRole("button", { name: "See the team" }));

  await openView(page, "Activity");
  await expectHittable(dialog(page).getByRole("button", { name: "developer", exact: true }));
  await expectHittable(dialog(page).getByRole("button", { name: /^WO-902/ }));

  await openView(page, "Context");
  await expectHittable(dialog(page).getByRole("button", { name: "Edit", exact: true }));
  await expectHittable(dialog(page).getByRole("button", { name: "Check again" }));

  await page.route("**/api/commands/recheck", (route) => route.abort());
  await dialog(page).getByRole("button", { name: "Check again" }).click();
  const unsent = page.getByRole("alert").filter({ hasText: "The command was not sent." });
  await expectHittable(unsent.getByRole("button", { name: "Dismiss this notice" }));
  expect(browserErrors.splice(0)).toEqual([expect.stringContaining("recheck")]);
});

test("the ways out of an office leave at least 24 by 24 to hit", async ({ page }) => {
  await page.goto(pairingLink);
  await expectHittable(page.getByRole("button", { name: `Disconnect from ${new URL(SESSION_OFFICE).host}` }));

  await page.route(`${SESSION_OFFICE}/api/meta`, (route) =>
    route.fulfill({ json: { contract: CONTRACT - 1, requiresSession: true }, headers: { "access-control-allow-origin": LOCAL_OFFICE } }),
  );
  await page.reload();
  await expectHittable(page.getByRole("button", { name: "Use another office" }));
});

test("the chat box, the pairing secret and the wardrobe take the product's focus ring", async ({ page }) => {
  await openProject(page, PROJECT);
  const chat = await openManagerChat(page);
  await chat.getByLabel("Message to the Manager").focus();
  await expectProductRing(page);

  await roster(page).getByRole("button", { name: "manager" }).click();
  await dialog(page).getByRole("button", { name: "Look", exact: true }).click();
  await dialog(page).getByLabel("DISPLAY ALIAS").press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest(".avatar-editor") !== null && document.activeElement?.tagName !== "BODY")).toBe(true);
  await expectProductRing(page);

  await page.goto(`${SESSION_OFFICE}/`);
  const [address, secret] = [page.getByLabel("Office address"), page.getByLabel("Pairing secret")];
  await secret.focus();
  await expectProductRing(page);
  const field = (input: HTMLElement | SVGElement) => {
    const style = getComputedStyle(input);
    return [style.width, style.padding, style.backgroundColor, style.border, style.borderRadius, style.fontSize];
  };
  await address.focus();
  expect(await secret.evaluate(field)).toEqual(await address.evaluate(field));
});

test("the dock's headings and the pause buttons show their focus ring inside the box that clips them", async ({ page }) => {
  await openStagedStudio(page);
  const [deskHeading, chatHeading] = [desk(page).getByRole("button", { name: /Decision desk/ }), page.getByRole("region", { name: "Your Manager" }).getByRole("button", { name: /Your Manager/ })];

  await expect(chatHeading).toHaveAttribute("aria-expanded", "false");
  await expectVisibleRing(chatHeading);
  await expectVisibleRing(deskHeading);
  for (const pause of await page.getByRole("group", { name: "Pause" }).getByRole("button").all()) await expectVisibleRing(pause);

  await openManagerChat(page);
  await expect(deskHeading).toHaveAttribute("aria-expanded", "false");
  await expectVisibleRing(deskHeading);
  await expectVisibleRing(chatHeading);
});

test("the connection screen with a problem to say fits a 320px screen without scrolling sideways", async ({ page, browserErrors }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${LOCAL_OFFICE}/#office=${encodeURIComponent(SESSION_OFFICE)}&secret=not-the-secret`);
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(browserErrors.splice(0)).toEqual([expect.stringContaining("401")]);
});

test("the primary button's ink is the token the design page names, and passes on mint", async ({ page }) => {
  await page.goto(`${SESSION_OFFICE}/`);
  const connect = page.getByRole("button", { name: "Connect" });
  const ink = await connect.evaluate((button) => {
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.color = "var(--sk-on-action)";
    const token = getComputedStyle(probe).color;
    probe.remove();
    return { colour: getComputedStyle(button).color, token };
  });
  expect(ink.colour).toBe(ink.token);
  await expectReadable(connect);
});

test("quiet text still keeps 4.5 to 1 against what is behind it", async ({ page }) => {
  await openStagedStudio(page);
  await expectReadable(page.locator(".side-footer"));
  await expectReadable(page.locator(".main-footer, .main-footer > span:last-child > span:last-child"));
  await expectReadable(page.locator(".activity-item small"));
  await expectReadable(roster(page).locator("small"));
  await expectReadable(desk(page).getByRole("group", { name: "Waiting for you" }).getByRole("button").locator("span"));

  await openView(page, "Work orders");
  await expectReadable(dialog(page).getByText("Nothing here."));

  await openView(page, "Activity");
  await expectReadable(dialog(page).locator(".timeline-entry small"));
  await expectReadable(dialog(page).locator(".event-sequence"));

  await openView(page, "Context");
  await expectReadable(dialog(page).locator(".pill"));
  await expectReadable(dialog(page).getByText("No setup checks have run."));
  await closeDialog(page);

  await roster(page).getByRole("button", { name: "developer" }).click();
  await expectReadable(dialog(page).locator(".agent-trace-entry time, .agent-trace-entry small"));
  await closeDialog(page);

  await page.getByRole("complementary").getByRole("button", { name: "Register a project" }).click();
  await expectReadable(dialog(page).getByPlaceholder("my-project"), "::placeholder");
});
