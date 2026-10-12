import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { StateSchema, commandPath, type State } from "@skynot/contract";

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

// An option only fills the answer: the director sends it, in the chat as at the desk.
export async function answerInChat(chat: Locator, option: string, turn: { timeout: number }): Promise<void> {
  const question = chat.locator(".chat-question").filter({ has: chat.page().getByRole("button", { name: option }) });
  await question.getByRole("button", { name: option }).click(turn);
  await question.getByRole("button", { name: "Answer", exact: true }).click();
}

// The desk shares its dock with the chat, and only one of the two is open.
export async function openDecisionDesk(page: Page): Promise<void> {
  const heading = page.getByRole("region", { name: "Decision desk" }).getByRole("button", { name: /Decision desk/ });
  if ((await heading.count()) > 0 && (await heading.getAttribute("aria-expanded")) === "false") await heading.click();
}

// Visible is not enough for a notice: a dialog or a panel can be painted over it.
export async function paintsOnTop(notice: Locator): Promise<boolean> {
  return notice.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  });
}

// The simulated shop is not in every state a spec needs: the office's answer is rewritten on its way to the studio, and refused when it is no longer one an office could send.
export async function stageState(page: Page, mutate: (state: State) => void): Promise<void> {
  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    const state = StateSchema.parse(await response.json());
    mutate(state);
    await route.fulfill({ response, json: StateSchema.parse(state) });
  });
}

// Asked of the office itself, so a case has an order to sign whichever case ran before it, or none.
export async function orderToSign(page: Page, project: string): Promise<string> {
  const turn = { timeout: 20_000 };
  const state = async () => StateSchema.parse(await (await page.request.get(`/api/state?project=${project}`)).json());
  const waiting = async () => (await state()).orders.findLast((order) => order.status === "awaiting_signature")?.id ?? "";
  const found = await waiting();
  if (found) return found;

  const asked = (await state()).decisions.length;
  await page.request.post(commandPath("send-message"), { data: { text: "Tidy the invoice footer", project } });
  await expect.poll(async () => (await state()).decisions.length, turn).toBeGreaterThan(asked);
  const question = (await state()).decisions.at(-1)!;
  await page.request.post(commandPath("answer-decision"), { data: { decisionId: question.id, answer: question.options[0] } });
  await expect.poll(waiting, turn).not.toBe("");
  return waiting();
}
