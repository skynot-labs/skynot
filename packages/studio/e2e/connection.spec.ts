import type { Page } from "@playwright/test";
import { CONTRACT } from "@skynot/contract";
import { LOCAL_OFFICE, PAIRING_SECRET, SESSION_OFFICE } from "./offices";
import { expect, openView, tellTheManager, test } from "./support";

declare global {
  interface Window {
    connectingCards: number;
    reconnectingSaid: number;
  }
}

const TURN = { timeout: 20_000 };
const SESSION_HOST = new URL(SESSION_OFFICE).host;

const pairingLink = (studio: string, secret: string) => `${studio}/#office=${encodeURIComponent(SESSION_OFFICE)}&secret=${secret}`;
const connectionScreen = (page: Page) => page.getByRole("heading", { name: "Connect to your office." });
const disconnect = (page: Page) => page.getByRole("button", { name: `Disconnect from ${SESSION_HOST}` });
const live = (page: Page) => page.getByText("LIVE", { exact: true });
const studioOf = (page: Page, project: string) => page.getByRole("heading", { level: 1 }).filter({ hasText: project });

test("a pairing link connects the studio to an office elsewhere, and the shop works through it", async ({ page }) => {
  const idea = "Tell the far office about invoices";

  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));

  await expect(disconnect(page)).toBeVisible();
  await expect(page).toHaveURL(`${LOCAL_OFFICE}/`);
  await expect(live(page)).toBeVisible();

  const chat = await tellTheManager(page, idea);
  await expect(chat.getByRole("article").filter({ hasText: "MANAGER" }).getByText(`Keep "${idea}" small, or cover the edge cases too?`)).toBeVisible(TURN);

  await page.reload();
  await expect(disconnect(page)).toBeVisible();
  await expect(page.getByText(idea).first()).toBeVisible();
});

test("a pairing link opened in a tab that already shows the studio pairs it, and leaves no secret in the address", async ({ page }) => {
  await page.goto("/");
  await expect(studioOf(page, "alpha")).toBeVisible();
  await expect(disconnect(page)).toBeHidden();

  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));

  await expect(disconnect(page)).toBeVisible();
  await expect(page).toHaveURL(`${LOCAL_OFFICE}/`);
});

test("a wrong secret says where the right one is, and the link's address and secret stay in the form", async ({ page, browserErrors }) => {
  await page.goto(pairingLink(LOCAL_OFFICE, "not-the-secret"));

  await expect(connectionScreen(page)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(
    "That is not this office's pairing secret. Copy it from the pairing link the office printed when it started, or from the file pairing.secret in the office's data folder.",
  );
  await expect(page.getByLabel("Office address")).toHaveValue(SESSION_OFFICE);
  await expect(page.getByLabel("Pairing secret")).toHaveValue("not-the-secret");
  await expect(page).toHaveURL(`${LOCAL_OFFICE}/`);

  const refusals = browserErrors.splice(0);
  expect(refusals).toHaveLength(1);
  expect(refusals[0]).toContain("401");
  expect(refusals[0]).toContain(`${SESSION_OFFICE}/api/sessions`);

  await page.getByLabel("Pairing secret").fill(PAIRING_SECRET);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(disconnect(page)).toBeVisible();
});

test("the studio says which office it is connecting to while that office has not answered", async ({ page }) => {
  let answer = () => {};
  const asked = new Promise<void>((resolve) => (answer = resolve));
  await page.route(`${SESSION_OFFICE}/api/sessions`, async (route) => {
    if (route.request().method() === "POST") await asked;
    await route.continue();
  });

  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));

  await expect(page.getByRole("heading", { name: `Connecting to ${SESSION_HOST}…` })).toBeVisible();
  answer();
  await expect(disconnect(page)).toBeVisible();
});

test("an office that never answers ends as one that could not be reached, with what to check", async ({ page }) => {
  await page.clock.install();
  await page.route(`${SESSION_OFFICE}/api/sessions`, () => {});

  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));
  await expect(page.getByRole("heading", { name: `Connecting to ${SESSION_HOST}…` })).toBeVisible();
  await page.clock.fastForward(15_000);

  await expect(connectionScreen(page)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(`Could not reach the office at ${SESSION_OFFICE}. Check, in this order:`);
  await expect(page.getByRole("alert")).toContainText("allow local network access for this site in the site's settings and reload");
  await expect(page.getByRole("alert")).toContainText("SKYNOT_STUDIO");
  await expect(page.getByLabel("Pairing secret")).toHaveValue(PAIRING_SECRET);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("an answer from the page's own office that comes after a pairing link connected changes nothing", async ({ page }) => {
  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route(`${LOCAL_OFFICE}/api/meta`, async (route) => {
    await held;
    await route.continue();
  });
  const asked = page.waitForRequest(`${LOCAL_OFFICE}/api/meta`);
  await page.goto("/");
  await asked;
  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));
  await expect(disconnect(page)).toBeVisible();

  const answered = page.waitForResponse(`${LOCAL_OFFICE}/api/meta`);
  answer();
  await answered;
  await page.waitForTimeout(1000);

  await expect(disconnect(page)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("skynot.connection"))).toContain(SESSION_OFFICE);
});

test("the page's own office never answering does not take the screen back from a pairing link that connected", async ({ page }) => {
  await page.clock.install();
  await page.route(`${LOCAL_OFFICE}/api/meta`, () => {});
  const asked = page.waitForRequest(`${LOCAL_OFFICE}/api/meta`);
  await page.goto("/");
  await asked;
  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));
  await expect(disconnect(page)).toBeVisible();

  await page.clock.fastForward(15_000);
  await page.waitForTimeout(500);

  await expect(disconnect(page)).toBeVisible();
  await expect(connectionScreen(page)).toBeHidden();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a wrong secret typed into the form keeps the form on screen and the focus in it", async ({ page, browserErrors }) => {
  await page.goto(`${SESSION_OFFICE}/`);
  await page.getByLabel("Pairing secret").fill("not-the-secret");
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("alert")).toContainText("That is not this office's pairing secret.");
  await expect(page.getByLabel("Pairing secret")).toHaveValue("not-the-secret");
  expect(await page.evaluate(() => document.querySelector("form")?.contains(document.activeElement))).toBe(true);
  expect(browserErrors.splice(0)).toEqual([expect.stringContaining("401")]);
});

test("the console's own office shows no connecting card when it answers at once, and shows it when it is slow", async ({ page }) => {
  await page.addInitScript(() => {
    window.connectingCards = 0;
    new MutationObserver(() => {
      if (document.body?.textContent?.includes("STUDIO · CONNECTING")) window.connectingCards++;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  await expect(studioOf(page, "alpha")).toBeVisible();
  expect(await page.evaluate(() => window.connectingCards)).toBe(0);

  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route(`${LOCAL_OFFICE}/api/meta`, async (route) => {
    await held;
    await route.continue();
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connecting…" })).toBeVisible();
  answer();
  await expect(studioOf(page, "alpha")).toBeVisible();
});

test("a fresh load never says it is reconnecting, and does not say it is live before the event stream answers", async ({ page }) => {
  await page.addInitScript(() => {
    window.reconnectingSaid = 0;
    new MutationObserver(() => {
      if (/reconnecting/i.test(document.body?.textContent ?? "")) window.reconnectingSaid++;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route("**/api/events*", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("region", { name: "alpha studio" })).toBeVisible();
  await expect(page.locator(".main-footer")).toContainText("HUMAN IN THE LOOP");
  await expect(live(page)).toHaveCount(0);

  answer();
  await expect(live(page)).toBeVisible();
  expect(await page.evaluate(() => window.reconnectingSaid)).toBe(0);
});

test("an event stream that never answers at all ends as reconnecting", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/events*", () => {});
  const reconnecting = page.locator(".main-footer").getByText("RECONNECTING", { exact: true });

  await page.goto("/");
  await expect(page.locator(".main-footer")).toContainText("HUMAN IN THE LOOP");
  await page.clock.fastForward(14_000);
  await expect(reconnecting).toHaveCount(0);
  await page.clock.fastForward(1_000);

  await expect(reconnecting).toBeVisible();
  await expect(live(page)).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// The office answers 500 to every read of its state until the returned function is called.
async function stateUnreadable(page: Page): Promise<() => void> {
  let unreadable = true;
  await page.route("**/api/state*", (route) => (unreadable ? route.fulfill({ status: 500, body: "" }) : route.continue()));
  return () => {
    unreadable = false;
  };
}

for (const width of [1280, 390])
  test(`a panel's address loaded while the state cannot be read leaves Retry and the sidebar usable at ${width} pixels, and the panel opens once it can`, async ({ page, browserErrors }) => {
    await page.setViewportSize({ width, height: 800 });
    const readable = await stateUnreadable(page);

    await page.goto("/#board");
    await expect(page.getByRole("alert")).toHaveText(/The shop did not answer \(500\)\./);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const control of ["Register a project", "Retry"]) {
      await page.getByRole("button", { name: control }).focus();
      await expect(page.getByRole("button", { name: control })).toBeFocused();
    }

    readable();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Work orders." })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    for (const refusal of browserErrors.splice(0)) expect(refusal).toContain("500");
  });

test("a state that stops being readable under an open panel says so in the panel, once, and its Retry works", async ({ page, browserErrors }) => {
  // The stream ends at once, so the studio reads the state again each time it reconnects.
  await page.route("**/api/events*", (route) => route.fulfill({ contentType: "text/event-stream", body: "" }));
  await page.goto("/");
  await expect(studioOf(page, "alpha")).toBeVisible();
  await openView(page, "Costs");
  const costs = page.getByRole("dialog", { name: "What it takes." });
  const notice = page.locator(".error-banner");

  const readable = await stateUnreadable(page);
  await expect(costs.getByRole("alert")).toHaveText(/The shop did not answer \(500\)\./);
  await expect(notice).toHaveCount(1);

  await costs.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("main").locator(".error-banner")).toBeVisible();
  await expect(notice).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await openView(page, "Costs");
  await expect(costs.locator(".error-banner")).toBeVisible();
  readable();
  await costs.getByRole("button", { name: "Retry" }).click();
  await expect(notice).toHaveCount(0);
  await expect(costs).toBeVisible();
  for (const refusal of browserErrors.splice(0)) expect(refusal).toContain("500");
});

test("disconnecting falls back to the office that serves this console", async ({ page }) => {
  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));
  await expect(studioOf(page, "alpha")).toBeVisible();

  await disconnect(page).click();

  await expect(studioOf(page, "alpha")).toBeVisible();
  await expect(disconnect(page)).toBeHidden();
  await expect(live(page)).toBeVisible();

  await page.reload();
  await expect(studioOf(page, "alpha")).toBeVisible();
  await expect(disconnect(page)).toBeHidden();
});

test("an office that asks for a session shows its own console the connection screen, with its address filled in", async ({ page }) => {
  await page.goto(`${SESSION_OFFICE}/`);

  await expect(connectionScreen(page)).toBeVisible();
  await expect(page.getByLabel("Office address")).toHaveValue(SESSION_OFFICE);
  await expect(page.getByRole("main")).toContainText("The office is the part of skynot you run yourself");
  await expect(page.getByRole("main")).toContainText("pairing.secret");
  await expect(page.getByRole("link", { name: "How to connect a studio" })).toHaveAttribute("href", "https://github.com/skynot-labs/skynot/blob/main/docs/connecting-a-studio.md");

  await page.getByLabel("Pairing secret").fill(PAIRING_SECRET);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(studioOf(page, "alpha")).toBeVisible();

  await disconnect(page).click();
  await expect(connectionScreen(page)).toBeVisible();
});

test("the studio published in a folder finds its own files and pages, and connects from there", async ({ page }) => {
  const studio = `${LOCAL_OFFICE}/github/studio`;

  await page.goto(pairingLink(studio, PAIRING_SECRET));

  await expect(disconnect(page)).toBeVisible();
  await expect(page).toHaveURL(`${studio}/`);
  await expect(live(page)).toBeVisible();
  await expect(page.getByRole("img", { name: "skynot" })).toHaveJSProperty("complete", true);
  await expect(page.getByRole("img", { name: "skynot" })).not.toHaveJSProperty("naturalWidth", 0);

  await page.getByRole("link", { name: "Identity and design", exact: true }).click();
  await expect(page).toHaveURL(`${studio}/?design`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/One studio\.\s*Many minds\./);

  await page.getByRole("link", { name: "Back to the studio", exact: true }).click();
  await expect(page).toHaveURL(`${studio}/`);
  await expect(disconnect(page)).toBeVisible();

  await page.getByRole("link", { name: "GitHub kit" }).click();
  await expect(page).toHaveURL(`${LOCAL_OFFICE}/github/`);
});

test("a session the office stopped accepting sends the studio back to the connection screen, and is forgotten", async ({ page, browserErrors }) => {
  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));
  await expect(disconnect(page)).toBeVisible();

  await page.evaluate((office) => localStorage.setItem("skynot.connection", JSON.stringify({ office, token: "a.session.the-office-never-signed" })), SESSION_OFFICE);
  await page.reload();

  await expect(connectionScreen(page)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("The office no longer accepts this session.");
  await expect(page.getByLabel("Office address")).toHaveValue(SESSION_OFFICE);
  const refusals = browserErrors.splice(0);
  expect(refusals.length).toBeGreaterThan(0);
  for (const refusal of refusals) expect(refusal).toMatch(new RegExp(`401.*${SESSION_OFFICE}/api/`));

  await page.reload();
  await expect(studioOf(page, "alpha")).toBeVisible();
  await expect(disconnect(page)).toBeHidden();
});

test("a console older than the office that serves it says how to rebuild it, and offers no way back to itself", async ({ page }) => {
  await page.route(`${LOCAL_OFFICE}/api/meta`, (route) => route.fulfill({ json: { contract: CONTRACT + 1, requiresSession: false } }));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "This studio and the office are different versions." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`This studio is version ${CONTRACT}; the office at ${new URL(LOCAL_OFFICE).host} is version ${CONTRACT + 1}. The studio is the older one.`);
  await expect(page.getByRole("main")).toContainText("Run npm run build:console, restart the office and reload this page.");
  await expect(page.getByRole("link", { name: "Open the office's own console" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Use another office" })).toBeHidden();

  await page.unroute(`${LOCAL_OFFICE}/api/meta`);
  await page.getByRole("button", { name: "Reload" }).click();
  await expect(studioOf(page, "alpha")).toBeVisible();
});

test("an office older than the studio paired with it says how to update it, and offers its own console", async ({ page }) => {
  await page.route(`${SESSION_OFFICE}/api/meta`, (route) =>
    route.fulfill({ json: { contract: CONTRACT - 1, requiresSession: true }, headers: { "access-control-allow-origin": LOCAL_OFFICE } }),
  );

  await page.goto(pairingLink(LOCAL_OFFICE, PAIRING_SECRET));

  await expect(page.getByRole("heading", { name: "This studio and the office are different versions." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`This studio is version ${CONTRACT}; the office at ${SESSION_HOST} is version ${CONTRACT - 1}. The office is the older one.`);
  await expect(page.getByRole("main")).toContainText("Update the office: git pull, npm ci, and start it again.");
  await expect(page.getByRole("link", { name: "Open the office's own console" })).toHaveAttribute("href", SESSION_OFFICE);

  await page.getByRole("button", { name: "Use another office" }).click();
  await expect(studioOf(page, "alpha")).toBeVisible();
});
