import type { Page } from "@playwright/test";
import { floorPoint, officeLayout } from "../src/ui/office-layout";
import { closeDialog, dialog, expect, openProject, openView, tellTheManager, test } from "./support";

async function clickOffice(page: Page, [x, y]: [number, number]): Promise<void> {
  const stage = page.locator(".office-stage canvas");
  await expect(page.locator(".studio-canvas-room.live")).toBeVisible();
  const box = (await stage.boundingBox())!;
  const scale = box.width / officeLayout.width;
  await page.mouse.click(box.x + x * scale, box.y + y * scale);
}

// The office fires at the next minute its own clock reads, so the report is at most a minute away.
const inAMinute = () => {
  const next = new Date(Date.now() + 60_000);
  return `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
};

test.describe("the clock and the reports", () => {
  test("the clock on the wall opens the scheduled tasks, with the morning report off", async ({ page }) => {
    await openProject(page, "alpha");
    await clickOffice(page, floorPoint(16.6, 0.04, 96));

    const panel = dialog(page);
    await expect(panel.getByRole("heading", { name: "On the clock." })).toBeVisible();
    await expect(panel.getByRole("switch", { name: "Morning report" })).not.toBeChecked();
    await expect(panel).toContainText("Off: nothing is scheduled.");
  });

  test("a report switched on at the clock is written at its time and waits unread in the reports", async ({ page }) => {
    test.setTimeout(120_000);
    await openProject(page, "alpha");
    const reports = page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Reports" });

    await openView(page, "Reports");
    await expect(dialog(page)).toContainText("No report yet.");
    await dialog(page).getByRole("button", { name: "Open the clock" }).click();
    await dialog(page).getByLabel("Every day at").fill(inAMinute());
    await dialog(page).getByRole("switch", { name: "Morning report" }).check();
    await expect(dialog(page)).toContainText("Next:");
    await closeDialog(page);

    await expect(reports).toContainText("1", { timeout: 75_000 });
    await reports.click();
    const report = dialog(page).getByRole("article");
    await expect(report).toContainText("Morning report");
    await expect(report).toContainText("New");
    await expect(report).toContainText("Delivered:");
    await expect(page).toHaveURL(/#reports$/);

    await closeDialog(page);
    await expect(reports).not.toContainText("1");
    await reports.click();
    await expect(dialog(page).getByRole("article")).not.toContainText("New");
  });

  test("a task asked for in the chat shows at the clock, with what asked for it, and is removed there", async ({ page }) => {
    await openProject(page, "alpha");
    const chat = await tellTheManager(page, "/later the stuck orders");
    await expect(chat).toContainText('Scheduled "the stuck orders": every Fri at 09:00.', { timeout: 20_000 });

    await page.getByRole("button", { name: "Open the scheduled tasks" }).click();
    const task = dialog(page).getByRole("article").filter({ hasText: "the stuck orders" });
    await expect(task).toContainText("every Fri at 09:00 · next:");
    await expect(task).toContainText("You asked: /later the stuck orders");

    await task.getByRole("button", { name: "Remove the task the stuck orders" }).click();
    await expect(task).toHaveCount(0);
    await expect(dialog(page).getByRole("switch", { name: "Morning report" })).toBeVisible();
  });
});
