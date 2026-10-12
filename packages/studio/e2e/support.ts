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
  // Decisions is the one entry without a panel: it turns the dock to the desk.
  if (view !== "Decisions") await expect(entry).toHaveAttribute("aria-current", "page");
}

export function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

// Closing an agent or an order gives back the panel it was opened from, so only the dialog that was closed is gone.
export async function closeDialog(page: Page): Promise<void> {
  const title = await dialog(page).getByRole("heading", { level: 2 }).first().innerText();
  await dialog(page).getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("dialog", { name: title })).toBeHidden();
}

// The chat lives beside the office, so whatever panel is open over it closes first.
export async function openManagerChat(page: Page): Promise<Locator> {
  while (await dialog(page).isVisible()) await closeDialog(page);
  await page.getByRole("button", { name: "Open the chat with the Manager" }).click();
  const chat = page.getByRole("region", { name: "Your Manager" });
  await expect(chat.getByRole("textbox", { name: "Message to the Manager" })).toBeVisible();
  return chat;
}

export async function tellTheManager(page: Page, message: string): Promise<Locator> {
  const chat = await openManagerChat(page);
  await chat.getByLabel("Message to the Manager").fill(message);
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByLabel("Message to the Manager")).toHaveValue("");
  await expect(chat.getByRole("article").filter({ hasText: "YOU · DIRECTOR" }).filter({ hasText: message })).toBeVisible();
  return chat;
}

// The desk shares its dock with the chat, and only one of the two is open.
export async function openDecisionDesk(page: Page): Promise<void> {
  const heading = page.getByRole("region", { name: "Decision desk" }).getByRole("button", { name: /Decision desk/ });
  if ((await heading.count()) > 0 && (await heading.getAttribute("aria-expanded")) === "false") await heading.click();
}
