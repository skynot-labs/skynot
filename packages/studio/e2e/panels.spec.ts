import type { Locator, Page } from "@playwright/test";
import { dialog, expect, openProject, openView, stageState, test } from "./support";

const sidebar = (page: Page): Locator => page.getByRole("complementary");
const roster = (page: Page): Locator => page.getByRole("region", { name: "Project team" });
const panel = (page: Page, title: string): Locator => page.locator("section").filter({ has: page.getByText(title, { exact: true }) }).last();
const followsTheStudio = (page: Page): Locator => dialog(page).getByLabel("Follow the studio wardrobe");

async function openLook(page: Page): Promise<void> {
  await openProject(page, "beta");
  await roster(page).getByRole("button", { name: "manager" }).click();
  await dialog(page).getByRole("tab", { name: "Look" }).click();
}

test.describe("a dialog and what was typed in it", () => {
  test("a click outside closes a dialog nothing was typed in", async ({ page }) => {
    await page.goto("/");
    await sidebar(page).getByRole("button", { name: "Register a project" }).click();
    await expect(dialog(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog(page)).toBeHidden();
  });

  test("a click outside keeps a form that holds typed text, and Escape still closes it", async ({ page }) => {
    await page.goto("/");
    await sidebar(page).getByRole("button", { name: "Register a project" }).click();
    await dialog(page).getByLabel("ID", { exact: true }).pressSequentially("gamma");
    await page.mouse.click(5, 5);
    await expect(dialog(page).getByLabel("ID", { exact: true })).toHaveValue("gamma");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });

  test("a click outside closes a form again once what was typed in it is gone", async ({ page }) => {
    await page.goto("/");
    await sidebar(page).getByRole("button", { name: "Register a project" }).click();
    await dialog(page).getByLabel("ID", { exact: true }).pressSequentially("gamma");
    await page.mouse.click(5, 5);
    await expect(dialog(page)).toBeVisible();

    await dialog(page).getByLabel("ID", { exact: true }).fill("");
    await page.mouse.click(5, 5);
    await expect(dialog(page)).toBeHidden();
  });
});

test.describe("an agent's look", () => {
  test("a visit to another tab of the desk keeps the unsaved look", async ({ page }) => {
    await openLook(page);
    await dialog(page).getByLabel("DISPLAY ALIAS").fill("Grace Hopper");
    await dialog(page).getByRole("tab", { name: "Soul" }).click();
    await expect(dialog(page).getByLabel("DISPLAY ALIAS")).toBeHidden();
    await dialog(page).getByRole("tab", { name: "Look" }).click();
    await expect(dialog(page).getByLabel("DISPLAY ALIAS")).toHaveValue("Grace Hopper");
  });

  test("choosing a garment or its colour stops following the studio wardrobe", async ({ page }) => {
    await openLook(page);
    await dialog(page).getByRole("tab", { name: "Wardrobe" }).click();

    await followsTheStudio(page).check();
    await dialog(page).getByRole("group", { name: "Top", exact: true }).getByRole("button", { pressed: false }).first().click();
    await expect(followsTheStudio(page)).not.toBeChecked();

    for (const colour of ["Top color 2", "Pants 8", "Shoes 3"]) {
      await followsTheStudio(page).check();
      await dialog(page).getByRole("button", { name: colour, exact: true }).click();
      await expect(followsTheStudio(page)).not.toBeChecked();
    }
  });

  test("a colour as dark as the dialog still has an edge", async ({ page }) => {
    await openLook(page);
    await dialog(page).getByRole("tab", { name: "Wardrobe" }).click();
    const darkest = dialog(page).getByRole("button", { name: "Pants 8", exact: true });
    await expect(darkest).toHaveAttribute("aria-pressed", "false");
    const edge = await darkest.evaluate((swatch) => {
      const style = getComputedStyle(swatch);
      return { width: style.borderTopWidth, differs: style.borderTopColor !== style.backgroundColor, opaque: !style.borderTopColor.includes(", 0)") };
    });
    expect(edge).toEqual({ width: "1px", differs: true, opaque: true });
  });
});

test.describe("the setup card", () => {
  test("a fix shows its command as code, without the backticks", async ({ page }) => {
    await stageState(page, (state) => {
      state.readiness = [{ check: "codex", level: "fail", detail: "The codex CLI is not installed.", fix: "Run `npm i -g @openai/codex`." }];
    });
    await openProject(page, "beta");
    await openView(page, "Context");
    const setup = panel(page, "Setup");
    await expect(setup.locator("code")).toHaveText("npm i -g @openai/codex");
    await expect(setup).toContainText("Run npm i -g @openai/codex.");
  });

  test("with no checks run, the card says how to run them", async ({ page }) => {
    await stageState(page, (state) => {
      state.readiness = [];
    });
    await openProject(page, "beta");
    await openView(page, "Context");
    const setup = panel(page, "Setup");
    await expect(setup).toContainText("No setup checks have run. Check again to run them.");
    await expect(setup.getByRole("button", { name: "Check again" })).toBeVisible();
  });
});

test("an activity filter that matches nothing names itself and gives everything back", async ({ page }) => {
  await stageState(page, (state) => {
    state.activity = [
      { sequence: 1, at: "2026-01-05T10:00:00.000Z", orderId: null, projectId: "beta", role: null, by: "director", kind: "order", text: "The director signed the first order.", url: null },
    ];
  });
  await openProject(page, "beta");
  await openView(page, "Activity");
  const kind = dialog(page).getByLabel("Filter the activity by kind");
  const person = dialog(page).getByLabel("Filter the activity by who did it");
  await expect(dialog(page).getByText("The director signed the first order.")).toBeVisible();

  await kind.selectOption({ label: "Runs" });
  await expect(dialog(page)).toContainText("Nothing in Runs yet.");
  await person.selectOption({ label: "you" });
  await expect(dialog(page)).toContainText("Nothing in Runs by you yet.");

  await dialog(page).getByRole("button", { name: "Show everything" }).click();
  await expect(dialog(page).getByText("The director signed the first order.")).toBeVisible();
  await expect(kind).toHaveValue("all");
  await expect(person).toHaveValue("all");
});

for (const width of [390, 1440]) {
  test(`at ${width}px a metric's detail stays inside its tile`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openProject(page, "beta");
    await openView(page, "Costs");
    const tile = page.getByRole("region", { name: "Project metrics" }).getByRole("button", { name: /COST TODAY/ });
    const tileBox = (await tile.boundingBox())!;
    const detailBox = (await tile.getByText(/on this project · UTC day/).boundingBox())!;
    expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(tileBox.x + tileBox.width);
  });
}
