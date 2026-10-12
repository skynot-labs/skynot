import type { Page } from "@playwright/test";
import { floorPoint, officeLayout, seatSpots } from "../src/ui/office-layout";
import { closeDialog, dialog, expect, openProject, test } from "./support";

// With reduced motion nobody leaves their desk, so a seat is where its agent is.
test.use({ reducedMotion: "reduce" });

async function clickOffice(page: Page, [x, y]: [number, number]): Promise<void> {
  const stage = page.locator(".office-stage canvas");
  await expect(page.locator(".studio-canvas-room.live")).toBeVisible();
  const box = (await stage.boundingBox())!;
  const scale = box.width / officeLayout.width;
  await page.mouse.click(box.x + x * scale, box.y + y * scale);
}

test.describe("the live office", () => {
  test("a click on an agent at its desk opens that agent's desk", async ({ page }) => {
    await openProject(page, "beta");
    const seat = officeLayout.seats.find((candidate) => candidate.zone === "development")!;
    const chair = seatSpots(seat).chair;
    const [x, y] = floorPoint(chair.u, chair.v);
    await clickOffice(page, [x, y - 70]);
    await expect(dialog(page).getByRole("button", { name: "Soul", exact: true })).toBeVisible();
    await expect(dialog(page)).toContainText("developer");
  });

  test("the board opens over the office, keeps its place in the address and gives the office back", async ({ page }) => {
    await openProject(page, "beta");
    await clickOffice(page, floorPoint(2.57, officeLayout.room.depth + 0.64, 24));
    await expect(dialog(page).getByRole("heading", { name: "Work orders." })).toBeVisible();
    await expect(page).toHaveURL(/#board$/);

    await page.reload();
    await expect(dialog(page).getByRole("heading", { name: "Work orders." })).toBeVisible();

    await closeDialog(page);
    await expect(page).not.toHaveURL(/#/);
    await expect(page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "The studio" })).toHaveAttribute("aria-current", "page");
  });

  test("the frame on the wall opens the project's stats and costs", async ({ page }) => {
    await openProject(page, "beta");
    await clickOffice(page, floorPoint(8.2, 0.04, 90));
    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "What it takes." })).toBeVisible();
    await expect(panel.getByRole("region", { name: "Project metrics" })).toContainText("ACTIVE RUNS");
    await expect(page).toHaveURL(/#costs$/);
  });

  test("the project's name opens what the team knows about it, over the office", async ({ page }) => {
    await openProject(page, "beta");
    await page.getByRole("banner").getByRole("button", { name: "beta" }).click();
    await expect(dialog(page).getByRole("heading", { name: "What the team knows." })).toBeVisible();
    await expect(page).toHaveURL(/#context$/);
    await closeDialog(page);
    await expect(page).not.toHaveURL(/#/);
  });

  test("the activity log opens over the office, and an order opened from it closes back to the log", async ({ page }) => {
    await openProject(page, "alpha");
    await page.getByRole("button", { name: "Open the activity log" }).click();
    const log = dialog(page);
    await expect(log.getByRole("heading", { name: "What happened." })).toBeVisible();
    await expect(page).toHaveURL(/#activity$/);

    await log.getByRole("button", { name: /^WO-\d+/ }).first().click();
    await expect(dialog(page).getByRole("heading", { name: "ACCEPTANCE CRITERIA" })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog(page).getByRole("heading", { name: "What happened." })).toBeVisible();

    await page.goBack();
    await expect(dialog(page)).toBeHidden();
  });

  test("the sidebar jumps from one panel to another without leaving the office", async ({ page }) => {
    await openProject(page, "alpha");
    await page.getByRole("button", { name: "Open the team" }).click();
    await expect(dialog(page).getByRole("heading", { name: "The right team." })).toBeVisible();
    await expect(page).toHaveURL(/#agents$/);

    const views = page.getByRole("navigation", { name: "Project views" });
    await views.getByRole("button", { name: "Work orders" }).click();
    await expect(dialog(page).getByRole("heading", { name: "Work orders." })).toBeVisible();
    await expect(dialog(page)).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect(views.getByRole("button", { name: "The studio" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".studio-canvas-room.live")).toBeVisible();
  });

  test("a notice takes its own room above the office, and a dismissed one stays dismissed after a reload", async ({ page }) => {
    await openProject(page, "alpha");
    const notice = page.getByRole("status").filter({ hasText: "SIMULATED ENGINES" });
    const office = page.getByRole("region", { name: "alpha studio" });
    await expect(notice).toBeVisible();
    const noticeBox = (await notice.boundingBox())!;
    const officeBox = (await office.boundingBox())!;
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(officeBox.y);

    await notice.getByRole("button", { name: "Dismiss this notice" }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(office).toBeVisible();
    await expect(notice).toHaveCount(0);
  });
});
