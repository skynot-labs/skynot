import type { Locator, Page } from "@playwright/test";
import { dialog, expect, openProject, openView, orderToSign, test } from "./support";

const PROJECT = "alpha";
const sidebar = (page: Page): Locator => page.getByRole("complementary");
const studio = (page: Page): Locator => page.getByRole("main");
const closeButton = (page: Page): Locator => dialog(page).getByRole("button", { name: "Close dialog" });
const workRow = (page: Page): Locator => studio(page).getByRole("button", { name: /^WO-\d+/ }).first();

// Where focus is, as the director would say it: in the open dialog, in the sidebar, on the brand, or the name of whatever else took it.
async function focusPlace(page: Page): Promise<string> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (!focused || focused === document.body) return "nowhere";
    if (focused.closest("dialog")) return "dialog";
    if (focused.closest("aside")) return "sidebar";
    if (focused.closest("header a[href='#studio']")) return "brand";
    return `${focused.tagName} ${focused.getAttribute("aria-label") ?? focused.textContent?.trim().slice(0, 40)}`;
  });
}

async function placesTabbedThrough(page: Page, presses: number): Promise<string[]> {
  await dialog(page).locator("button, input, a[href]").last().focus();
  const places = new Set<string>();
  for (let press = 0; press < presses; press++) {
    await page.keyboard.press("Tab");
    places.add(await focusPlace(page));
  }
  // Past the last control Tab leaves the page for the browser's own, which a headless one shows as focus on nothing.
  places.delete("nowhere");
  return [...places].sort();
}

test.describe("what an open panel covers", () => {
  test("Tab stays in the panel, the sidebar and the brand, and the sidebar still switches panels", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openProject(page, PROJECT);
    await openView(page, "Work orders");

    expect(await placesTabbedThrough(page, 60)).toEqual(["brand", "dialog", "sidebar"]);

    await sidebar(page).getByRole("button", { name: "Costs" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog(page).getByRole("heading", { name: "What it takes." })).toBeVisible();

    await closeButton(page).click();
    for (const covered of ["Open the team", "Style the studio", "Open the chat with the Manager"]) {
      await page.getByRole("button", { name: covered }).focus();
      await expect(page.getByRole("button", { name: covered })).toBeFocused();
    }
  });

  test("on a phone the panel covers the sidebar too, and Tab stays in the panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openProject(page, PROJECT);
    await openView(page, "Work orders");

    expect(await placesTabbedThrough(page, 60)).toEqual(["dialog"]);

    await closeButton(page).click();
    await sidebar(page).getByRole("button", { name: "Costs" }).focus();
    await expect(sidebar(page).getByRole("button", { name: "Costs" })).toBeFocused();
  });
});

test.describe("focus after a dialog closes", () => {
  const openers: Array<{ name: string; opener: (page: Page) => Locator }> = [
    { name: "a work row", opener: workRow },
    { name: "a team member", opener: (page) => page.getByRole("region", { name: "Project team" }).getByRole("button", { name: "manager" }) },
    { name: "the gear", opener: (page) => page.getByRole("button", { name: "Style the studio" }) },
    { name: "the plus", opener: (page) => page.getByRole("button", { name: "Register a project" }) },
    { name: "the sidebar's Costs", opener: (page) => sidebar(page).getByRole("button", { name: "Costs" }) },
    { name: "the team shortcut", opener: (page) => page.getByRole("button", { name: "Open the team" }) },
  ];
  // Each way in is closed the way the same hand would close it: the keyboard never touches the mouse, and the other way round.
  const hands: Array<{ name: string; open: (opener: Locator) => Promise<void>; close: (page: Page) => Promise<void> }> = [
    {
      name: "Enter then Escape",
      open: async (opener) => {
        await opener.focus();
        await opener.page().keyboard.press("Enter");
      },
      close: (page) => page.keyboard.press("Escape"),
    },
    { name: "a click then the Close button", open: (opener) => opener.click(), close: (page) => closeButton(page).click() },
  ];

  for (const { name, opener } of openers)
    for (const hand of hands)
      test(`${hand.name} returns focus to ${name}`, async ({ page }) => {
        await orderToSign(page, PROJECT);
        await openProject(page, PROJECT);
        await hand.open(opener(page));
        await expect(dialog(page)).toBeVisible();
        await hand.close(page);
        await expect(dialog(page)).toBeHidden();
        await expect(opener(page)).toBeFocused();
      });

  for (const hand of hands)
    test(`${hand.name} on an order opened from the board returns focus to its card, with the board as it was`, async ({ page }) => {
      const order = await orderToSign(page, PROJECT);
      await openProject(page, PROJECT);
      await openView(page, "Work orders");
      await dialog(page).getByRole("searchbox", { name: "Search work orders" }).fill(order);
      const card = dialog(page).getByRole("button", { name: new RegExp(order) });
      await hand.open(card);
      await expect(dialog(page).getByRole("heading", { name: "ACCEPTANCE CRITERIA" })).toBeVisible();
      await expect(dialog(page)).toHaveCount(1);

      await hand.close(page);
      await expect(dialog(page).getByRole("heading", { name: "Work orders." })).toBeVisible();
      await expect(card).toBeFocused();
      await expect(dialog(page).getByRole("searchbox", { name: "Search work orders" })).toHaveValue(order);
    });

  test("an order opened from the board with Enter and closed at once with Escape returns focus to its card, five times running", async ({ page }) => {
    const order = await orderToSign(page, PROJECT);
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    const card = dialog(page).getByRole("button", { name: new RegExp(order) });
    await card.focus();

    for (let round = 1; round <= 5; round++) {
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
      await expect(dialog(page).getByRole("heading", { name: "Work orders." }), `round ${round}`).toBeVisible();
      await expect(card, `round ${round}`).toBeFocused();
    }
  });

  test("a panel nothing opened gives focus to the studio when it closes", async ({ page }) => {
    await openProject(page, PROJECT);
    await page.goto("/#board");
    await expect(dialog(page).getByRole("heading", { name: "Work orders." })).toBeVisible();
    await closeButton(page).click();
    await expect(studio(page)).toBeFocused();
  });
});

test.describe("Escape and what was typed", () => {
  test("Escape closes a dialog nothing was typed in", async ({ page }) => {
    await openProject(page, PROJECT);
    await sidebar(page).getByRole("button", { name: "Register a project" }).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();

    await openView(page, "Work orders");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });

  test("Escape, pressed three times, keeps a project being registered, and the Close button still closes", async ({ page }) => {
    await openProject(page, PROJECT);
    await sidebar(page).getByRole("button", { name: "Register a project" }).click();
    await dialog(page).getByLabel("ID", { exact: true }).pressSequentially("gamma");
    for (let press = 0; press < 3; press++) await page.keyboard.press("Escape");
    await expect(dialog(page).getByLabel("ID", { exact: true })).toHaveValue("gamma");
    await expect(dialog(page)).toBeVisible();

    await closeButton(page).click();
    await expect(dialog(page)).toBeHidden();
  });

  test("Escape, pressed three times, keeps an alias being typed for an agent", async ({ page }) => {
    await openProject(page, PROJECT);
    await page.getByRole("region", { name: "Project team" }).getByRole("button", { name: "manager" }).click();
    await dialog(page).getByRole("button", { name: "Look", exact: true }).click();
    await dialog(page).getByLabel("DISPLAY ALIAS").pressSequentially("Grace");
    for (let press = 0; press < 3; press++) await page.keyboard.press("Escape");
    await expect(dialog(page).getByLabel("DISPLAY ALIAS")).toHaveValue("Grace");
    await expect(dialog(page)).toBeVisible();
  });

  test("Escape in the board's search clears the search, and the next one closes the board", async ({ page }) => {
    await orderToSign(page, PROJECT);
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    const search = dialog(page).getByRole("searchbox", { name: "Search work orders" });
    const cards = dialog(page).getByRole("button", { name: /WO-\d+/ });
    await search.pressSequentially("no order is called this");
    await expect(cards).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(search).toHaveValue("");
    await expect(cards).not.toHaveCount(0);
    await expect(dialog(page).getByRole("heading", { name: "Work orders." })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });

  test("Escape clears the board's search in a browser that leaves the clearing to the page", async ({ page }) => {
    await orderToSign(page, PROJECT);
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    const search = dialog(page).getByRole("searchbox", { name: "Search work orders" });
    const cards = dialog(page).getByRole("button", { name: /WO-\d+/ });
    await search.pressSequentially("no order is called this");
    await expect(cards).toHaveCount(0);

    // A key the page makes up carries none of the browser's own behaviour, which is what Firefox gives Escape in a search field.
    await search.dispatchEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await expect(search).toHaveValue("");
    await expect(cards).not.toHaveCount(0);
    await expect(dialog(page).getByRole("heading", { name: "Work orders." })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });
});

test.describe("the shell from the keyboard", () => {
  test("the first Tab stop skips to the studio, and the next one is its first control", async ({ page }) => {
    await openProject(page, PROJECT);
    await page.reload();
    await expect(studio(page).getByRole("button").first()).toBeVisible();
    const skip = page.getByRole("link", { name: "Skip to the studio" });
    await expect(skip).not.toBeInViewport();

    await page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await page.keyboard.press("Enter");
    await expect(studio(page)).toBeFocused();
    await expect(dialog(page)).toBeHidden();

    await page.keyboard.press("Tab");
    await expect(studio(page).locator("button:enabled, a[href], input, textarea").first()).toBeFocused();
  });

  test("the selected project says so to assistive technology", async ({ page }) => {
    await openProject(page, PROJECT);
    await expect(sidebar(page).getByRole("button", { name: "alpha" })).toHaveAttribute("aria-current", "true");
    await expect(sidebar(page).getByRole("button", { name: "beta" })).not.toHaveAttribute("aria-current");
  });
});
