import type { Page } from "@playwright/test";
import { floorPoint, officeLayout } from "../src/ui/office-layout";
import { dialog, expect, openProject, test } from "./support";

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

  test("the board leads to the work orders", async ({ page }) => {
    await openProject(page, "beta");
    await clickOffice(page, floorPoint(2.57, officeLayout.room.depth + 0.64, 24));
    await expect(page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Work orders" })).toHaveAttribute("aria-current", "page");
  });
});
