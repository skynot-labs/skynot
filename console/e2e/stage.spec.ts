import type { Page } from "@playwright/test";
import { floorPoint, officeLayout } from "../src/ui/office-layout";
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
    const [x, y] = floorPoint(seat.u + 0.9, seat.v + 1.1);
    await clickOffice(page, [x, y - 80]);
    await expect(dialog(page).getByRole("tab", { name: "Soul" })).toBeVisible();
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

  test("the activity log opens over the office, and an order opened from it closes back to the log", async ({ page }) => {
    await openProject(page, "alpha");
    await page.getByRole("button", { name: "Open the activity log" }).click();
    const log = dialog(page);
    await expect(log.getByRole("heading", { name: "What happened." })).toBeVisible();
    await expect(page).toHaveURL(/#activity$/);

    await log.getByRole("button", { name: /^WO-\d+/ }).first().click();
    await expect(dialog(page).getByRole("heading", { name: "An order with intent." })).toBeVisible();
    await dialog(page).getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog(page).getByRole("heading", { name: "What happened." })).toBeVisible();

    await page.goBack();
    await expect(dialog(page)).toBeHidden();
  });
});
