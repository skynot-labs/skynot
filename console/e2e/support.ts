import { expect, test as base, type Locator, type Page } from "@playwright/test";

export type ProjectView = "The studio" | "Decisions" | "Work orders" | "Agents" | "Activity" | "Context" | "Costs";

export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(`console: ${message.text()} ${message.location().url}`.trim());
      });
      page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
      await use(errors);
      expect(errors, "the browser reported errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function openProject(page: Page, projectId: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("complementary").getByRole("button", { name: projectId }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(projectId);
}

export async function openView(page: Page, view: ProjectView): Promise<void> {
  const entry = page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: view });
  await entry.click();
  await expect(entry).toHaveAttribute("aria-current", "page");
}

export function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

export async function closeDialog(page: Page): Promise<void> {
  await dialog(page).getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog(page)).toBeHidden();
}
