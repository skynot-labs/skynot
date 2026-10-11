import type { Page } from "@playwright/test";
import { CONTRACT } from "../../src/app/http/contract";
import { LOCAL_OFFICE, PAIRING_SECRET, SESSION_OFFICE } from "./offices";
import { expect, tellTheManager, test } from "./support";

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

test("a wrong secret is refused in the office's own words", async ({ page, browserErrors }) => {
  await page.goto(pairingLink(LOCAL_OFFICE, "not-the-secret"));

  await expect(connectionScreen(page)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("that is not this office's pairing secret");
  await expect(page.getByLabel("Office address")).toHaveValue(SESSION_OFFICE);
  await expect(page).toHaveURL(`${LOCAL_OFFICE}/`);

  const refusals = browserErrors.splice(0);
  expect(refusals).toHaveLength(1);
  expect(refusals[0]).toContain("401");
  expect(refusals[0]).toContain(`${SESSION_OFFICE}/api/sessions`);
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

test("a studio and an office that speak different contracts say so instead of starting", async ({ page }) => {
  await page.route(`${LOCAL_OFFICE}/api/meta`, (route) => route.fulfill({ json: { contract: CONTRACT + 1, requiresSession: false } }));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "This studio and the office do not match." })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(`This studio speaks contract ${CONTRACT}; the office at ${new URL(LOCAL_OFFICE).host} speaks contract ${CONTRACT + 1}.`);
  await expect(page.getByRole("link", { name: "Open the office's own console" })).toHaveAttribute("href", LOCAL_OFFICE);
});
