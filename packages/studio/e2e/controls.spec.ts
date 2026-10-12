import type { Locator, Page } from "@playwright/test";
import type { Decision, InboxItem, Message, Order } from "@skynot/contract";
import { STAGED_AT, dialog, expect, openDecisionDesk, openManagerChat, openProject, stageState, stagedOrder, test } from "./support";

const PROJECT = "beta";

type Shop = { inbox: InboxItem[]; orders: Order[]; chat: Message[]; decisions: Decision[] };
type Staged = { commands: string[]; hold: () => () => void };

const desk = (page: Page) => page.getByRole("region", { name: "Decision desk" });
const lists = (page: Page) => desk(page).getByRole("group", { name: "Waiting for you" });
const list = (page: Page, title: "To decide" | "To sign") => desk(page).getByRole("group", { name: new RegExp(`^${title}`) });
const item = (page: Page, text: string) => desk(page).getByRole("article").filter({ hasText: text });

const question = (id: string, text: string): InboxItem => ({ id, kind: "manager_question", from: "manager", question: text, options: ["Left", "Right"], orderId: null, ticket: null, askedAt: STAGED_AT });

// The simulated shop is left as it was: every command is answered here, and the staged state follows it.
async function stageShop(page: Page, shop: Partial<Shop>): Promise<Staged> {
  const staged: Shop = { inbox: [], orders: [], chat: [], decisions: [], ...shop };
  const commands: string[] = [];
  let held: Promise<void> | null = null;
  const settle = (status: Order["status"], matches: (order: Order) => boolean) => {
    staged.orders = staged.orders.map((order) => (matches(order) ? { ...order, status } : order));
  };
  await stageState(page, (state) => {
    if (state.project.id === PROJECT) Object.assign(state, staged);
  });
  // The stream ends at once, so the studio reads the state again each time it reconnects.
  await page.route("**/api/events*", (route) => route.fulfill({ contentType: "text/event-stream", body: "" }));
  await page.route("**/api/commands/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const payload: Record<string, unknown> = route.request().postDataJSON();
    commands.push(name);
    await held;
    if (name === "answer-decision") {
      staged.inbox = staged.inbox.filter((asked) => asked.id !== payload.decisionId);
      staged.decisions = staged.decisions.filter((asked) => asked.id !== payload.decisionId);
    }
    if (name === "sign-plan") settle("signed", (order) => order.plan === payload.plan);
    if (name === "sign-order") settle("signed", (order) => order.id === payload.orderId);
    if (name === "discard-order") settle("discarded", (order) => order.id === payload.orderId);
    await route.fulfill({ json: {} });
  });
  return {
    commands,
    hold: () => {
      let release = () => {};
      held = new Promise((resolve) => (release = resolve));
      return release;
    },
  };
}

async function openDesk(page: Page): Promise<void> {
  await openProject(page, PROJECT);
  await openDecisionDesk(page);
}

async function pressWithKeyboard(button: Locator): Promise<void> {
  await button.focus();
  await button.page().keyboard.press("Enter");
}

test.describe("where the keyboard is after a command", () => {
  test("an answer at the desk leaves focus on the questions that remain, then on the row that names the lists", async ({ page }) => {
    await stageShop(page, { inbox: [question("question-1", "Which footer?"), question("question-2", "Which header?")], orders: [stagedOrder("WO-901", "awaiting_signature")] });
    await openDesk(page);

    await item(page, "Which footer?").getByLabel("Your call").fill("Left");
    await page.keyboard.press("Tab");
    await expect(item(page, "Which footer?").getByRole("button", { name: "Send answer" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(item(page, "Which footer?")).toBeHidden();
    await expect(list(page, "To decide")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(item(page, "Which header?").locator(":focus")).toHaveCount(1);

    await item(page, "Which header?").getByLabel("Your call").fill("Right");
    await pressWithKeyboard(item(page, "Which header?").getByRole("button", { name: "Send answer" }));
    await expect(item(page, "WO-901")).toBeVisible();
    await expect(lists(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(lists(page).getByRole("button", { name: "To decide" })).toBeFocused();
  });

  test("a signature and a discard at the desk leave focus on what is left to sign, then on the row that names the lists", async ({ page }) => {
    await stageShop(page, { orders: [stagedOrder("WO-901", "awaiting_signature"), stagedOrder("WO-902", "awaiting_signature")] });
    await openDesk(page);

    await pressWithKeyboard(item(page, "WO-901").getByRole("button", { name: "Sign", exact: true }));
    await expect(item(page, "WO-901")).toBeHidden();
    await expect(list(page, "To sign")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(item(page, "WO-902").locator(":focus")).toHaveCount(1);

    await pressWithKeyboard(item(page, "WO-902").getByRole("button", { name: "Discard" }));
    await expect(desk(page).getByRole("heading", { name: "Nothing to sign." })).toBeVisible();
    await expect(lists(page)).toBeFocused();
  });

  for (const [action, became] of [["Sign", "Signed"], ["Discard", "Discarded"]] as const) {
    test(`${action} in an order's dialog leaves focus on the row that says what the order became`, async ({ page }) => {
      await stageShop(page, { orders: [stagedOrder("WO-901", "awaiting_signature")] });
      await openDesk(page);
      await item(page, "WO-901").getByRole("button", { name: "Open detail" }).click();

      const pressed = dialog(page).getByRole("button", { name: action, exact: true });
      await pressWithKeyboard(pressed);
      await expect(pressed).toBeHidden();
      const status = dialog(page).locator(".order-detail-top");
      await expect(status).toContainText(became);
      await expect(status).toBeFocused();
    });
  }

  test("a message and an answer in the chat leave focus in the message box", async ({ page }) => {
    await stageShop(page, {
      chat: [{ id: "message-1", author: "manager", text: "One thing first.", at: STAGED_AT, orderId: null, decisionId: "question-1", consulted: [] }],
      decisions: [{ id: "question-1", question: "Which footer?", options: ["Left", "Right"], askedAt: STAGED_AT, ticket: null, answer: null, answeredAt: null }],
    });
    await openProject(page, PROJECT);
    const chat = await openManagerChat(page);
    const box = chat.getByLabel("Message to the Manager");

    await box.fill("Tidy the invoice footer");
    await page.keyboard.press("Tab");
    await expect(chat.getByRole("button", { name: "Send" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();

    await chat.getByLabel("Your answer to: Which footer?").fill("Left");
    await pressWithKeyboard(chat.getByRole("button", { name: "Answer", exact: true }));
    await expect(chat.locator(".chat-question")).toBeHidden();
    await expect(box).toBeFocused();
  });

  test("a button keeps focus while its command is on the way, and a second press sends nothing", async ({ page }) => {
    const shop = await stageShop(page, { inbox: [question("question-1", "Which footer?")], orders: [stagedOrder("WO-901", "awaiting_signature")] });
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/commands/")) requests.push(request.url());
    });
    await openDesk(page);

    let release = shop.hold();
    const call = item(page, "Which footer?").getByLabel("Your call");
    await call.fill("Left");
    await call.press("Control+Enter");
    const sendAnswer = item(page, "Which footer?").getByRole("button", { name: "Send answer" });
    await expect(sendAnswer).toHaveAttribute("aria-disabled", "true");
    await call.press("Control+Enter");
    await call.press("Tab");
    await expect(sendAnswer).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(sendAnswer).toBeFocused();
    release();
    await expect(item(page, "Which footer?")).toBeHidden();
    expect(requests).toHaveLength(1);

    release = shop.hold();
    const sign = item(page, "WO-901").getByRole("button", { name: "Sign", exact: true });
    await pressWithKeyboard(sign);
    await expect(sign).toHaveAttribute("aria-disabled", "true");
    await expect(sign).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    release();
    await expect(item(page, "WO-901")).toBeHidden();
    expect(shop.commands).toEqual(["answer-decision", "sign-plan"]);
    expect(requests).toHaveLength(2);
  });
});

test.describe("the buttons that choose what a panel shows", () => {
  test("say which one is pressed, and name no tab or panel that is not there", async ({ page }) => {
    await stageShop(page, { orders: [stagedOrder("WO-901", "awaiting_signature")] });
    await openDesk(page);

    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(lists(page).getByRole("button")).toHaveText([/To decide/, /To sign/, /Blocked/, /Answered/]);
    await expect(lists(page).getByRole("button", { pressed: true })).toHaveText(/To sign/);
    await lists(page).getByRole("button", { name: "Answered" }).click();
    await expect(lists(page).getByRole("button", { pressed: true })).toHaveText(/Answered/);
    await expect(desk(page).getByRole("heading", { name: "No answers yet." })).toBeVisible();

    await page.getByRole("region", { name: "Project team" }).getByRole("button", { name: "manager" }).click();
    const agent = dialog(page).getByRole("group", { name: "Agent" });
    await expect(agent.getByRole("button", { pressed: true })).toHaveText("Work");
    await agent.getByRole("button", { name: "Look" }).click();
    await expect(agent.getByRole("button", { pressed: true })).toHaveText("Look");
    const avatar = dialog(page).getByRole("group", { name: "Avatar customization" });
    await avatar.getByRole("button", { name: "Wardrobe" }).click();
    await expect(avatar.getByRole("button", { pressed: true })).toHaveText("Wardrobe");
    await expect(dialog(page).getByText("QUICK LOOKS")).toBeVisible();
    expect(await page.locator("[role=tab], [role=tabpanel], [aria-selected], [aria-controls]").count()).toBe(0);
    expect(await page.locator("[aria-labelledby]").evaluateAll((labelled) => labelled.filter((element) => !document.getElementById(element.getAttribute("aria-labelledby") ?? "")).length)).toBe(0);
  });
});

test.describe("the boxes that send on Ctrl+Enter", () => {
  test("say so where the director writes, at the desk as in the chat", async ({ page }) => {
    const shop = await stageShop(page, { inbox: [question("question-1", "Which footer?")] });
    await openDesk(page);

    const call = item(page, "Which footer?").getByLabel("Your call");
    await expect(call).toHaveAttribute("placeholder", /Ctrl\+Enter sends it\.$/);
    await expect(item(page, "Which footer?").getByRole("button", { name: "Send answer" })).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    await call.fill("Left\nand centred");
    await call.press("Enter");
    expect(shop.commands).toEqual([]);
    await call.press("Control+Enter");
    await expect(item(page, "Which footer?")).toBeHidden();
    expect(shop.commands).toEqual(["answer-decision"]);

    const chat = await openManagerChat(page);
    const box = chat.getByLabel("Message to the Manager");
    await expect(box).toHaveAttribute("placeholder", /Ctrl\+Enter sends it\.$/);
    await expect(chat.getByRole("button", { name: "Send" })).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    await box.fill("Tidy the invoice footer");
    await box.press("Control+Enter");
    await expect(box).toHaveValue("");
    expect(shop.commands).toEqual(["answer-decision", "send-message"]);
  });
});

test.describe("at 400% zoom", () => {
  test.use({ viewport: { width: 320, height: 200 }, deviceScaleFactor: 4 });

  test("the sidebar scrolls away, so it covers no part of the chat's message box when focus lands there", async ({ page }) => {
    await openDesk(page);
    await page.getByRole("button", { name: "Open the chat with the Manager" }).focus();
    await page.keyboard.press("Enter");

    const box = page.getByRole("region", { name: "Your Manager" }).getByLabel("Message to the Manager");
    await expect(box).toBeFocused();
    await expect
      .poll(() =>
        box.evaluate((element) => {
          const frame = element.getBoundingClientRect();
          return [frame.top + 1, frame.top + frame.height / 2, frame.bottom - 1].map((y) => document.elementFromPoint(frame.left + frame.width / 2, y) === element);
        }),
      )
      .toEqual([true, true, true]);
  });
});
