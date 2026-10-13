import type { Locator, Page } from "@playwright/test";
import type { BriefingChange, Decision, InboxItem, Message, Order, TeamChange } from "@skynot/contract";
import { STAGED_AT, dialog, expect, openDecisionDesk, openManagerChat, openProject, openView, stageState, stagedOrder, test } from "./support";

const PROJECT = "beta";

type Shop = { inbox: InboxItem[]; orders: Order[]; chat: Message[]; decisions: Decision[]; teamChanges: TeamChange[]; briefingChanges: BriefingChange[]; workers?: string[] };
type Staged = { commands: string[]; hold: () => () => void };

const desk = (page: Page) => page.getByRole("region", { name: "Decision desk" });
const lists = (page: Page) => desk(page).getByRole("group", { name: "Waiting for you" });
const list = (page: Page, title: "To decide" | "To sign") => desk(page).getByRole("group", { name: new RegExp(`^${title}`) });
const item = (page: Page, text: string) => desk(page).getByRole("article").filter({ hasText: text });

const question = (id: string, text: string): InboxItem => ({ id, kind: "manager_question", from: "manager", question: text, options: ["Left", "Right"], orderId: null, ticket: null, askedAt: STAGED_AT });

// The simulated shop is left as it was: every command is answered here, and the staged state follows it.
async function stageShop(page: Page, shop: Partial<Shop>): Promise<Staged> {
  const staged: Shop = { inbox: [], orders: [], chat: [], decisions: [], teamChanges: [], briefingChanges: [], ...shop };
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
    if (name === "answer-question") staged.orders = staged.orders.map((order) => (order.id === payload.orderId ? { ...order, question: null } : order));
    if (name === "reassign-order") staged.orders = staged.orders.map((order) => (order.id === payload.orderId ? { ...order, worker: String(payload.worker) } : order));
    if (name.endsWith("-team-change")) staged.teamChanges = staged.teamChanges.filter((change) => change.id !== payload.changeId);
    if (name.endsWith("-briefing-change")) staged.briefingChanges = staged.briefingChanges.filter((change) => change.id !== payload.changeId);
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

const hire = (id: string, role: string): TeamChange => ({ id, action: "hire", role, reason: `the footer needs a ${role}`, focus: null, status: "pending", proposedAt: STAGED_AT });
const newBriefing = (id: string): BriefingChange => ({ id, projectId: PROJECT, text: "Marta reads only Spanish.", reason: "the director said so", status: "pending", proposedAt: STAGED_AT });
// An order its worker stopped on to ask, with a pull request open: it takes an answer first and a follow-up after.
const askingInReview = (id: string): Order => stagedOrder(id, "in_review", { question: "Which footer?", pullRequest: 12, issue: 7 });
const teamMember = (page: Page, role: string) => page.getByRole("region", { name: "Project team" }).getByRole("button", { name: role });

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

  test("a worker's question shown in the chat is answered there, once, for its own order", async ({ page }) => {
    const about = (id: string, orderId: string, text: string): Message => ({ id, author: "manager", text, at: STAGED_AT, orderId, decisionId: null, consulted: [] });
    const shop = await stageShop(page, {
      orders: [stagedOrder("WO-901", "on_bench", { question: "Which footer?" }), stagedOrder("WO-902", "on_bench")],
      chat: [
        about("message-1", "WO-901", "Here is the order for the footer."),
        about("message-2", "WO-902", "WO-902 is blocked: the worker gave up."),
        about("message-3", "WO-901", "WO-901 has a question for you: Which footer? Answer it here, on its card or in the inbox."),
      ],
    });
    const sent: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/commands/answer-question")) sent.push(request.postDataJSON());
    });
    await openProject(page, PROJECT);
    const chat = await openManagerChat(page);
    const asked = chat.getByRole("article").filter({ hasText: "has a question for you" });

    await expect(chat.getByRole("textbox", { name: "Answer", exact: true })).toHaveCount(1);
    await expect(asked.getByText("The worker is waiting for your answer: Which footer?")).toBeVisible();
    await asked.getByRole("textbox", { name: "Answer", exact: true }).fill("The left one");
    await pressWithKeyboard(asked.getByRole("button", { name: "Answer", exact: true }));

    await expect(chat.getByRole("textbox", { name: "Answer", exact: true })).toHaveCount(0);
    await expect(chat.getByLabel("Message to the Manager")).toBeFocused();
    expect(sent).toEqual([{ orderId: "WO-901", answer: "The left one" }]);
    expect(shop.commands).toEqual(["answer-question"]);
  });

  test("an answer and a follow-up from an agent's desk leave focus in the desk's box", async ({ page }) => {
    const shop = await stageShop(page, { orders: [askingInReview("WO-901")] });
    await openProject(page, PROJECT);
    await teamMember(page, "developer").click();

    const answer = dialog(page).getByLabel("ANSWER WO-901");
    await answer.fill("Left");
    await page.keyboard.press("Tab");
    await expect(dialog(page).getByRole("button", { name: "Answer", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    const redirect = dialog(page).getByLabel("REDIRECT WO-901");
    await expect(redirect).toHaveValue("");
    await expect(redirect).toBeFocused();

    await redirect.fill("Resolve the conflicts with main");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(redirect).toHaveValue("");
    await expect(redirect).toBeFocused();
    expect(shop.commands).toEqual(["answer-question", "follow-up"]);
  });

  test("an answer in an order's dialog leaves focus on the row that says where the order is, and a follow-up in its own field", async ({ page }) => {
    const shop = await stageShop(page, { orders: [askingInReview("WO-901")] });
    await openProject(page, PROJECT);
    await teamMember(page, "developer").click();
    await dialog(page).getByRole("button", { name: /^WO-901/ }).click();

    await dialog(page).getByLabel("Answer", { exact: true }).fill("Left");
    await page.keyboard.press("Tab");
    await expect(dialog(page).getByRole("button", { name: "Answer", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog(page).getByText("The worker is waiting for your answer")).toBeHidden();
    await expect(dialog(page).locator(".order-detail-top")).toBeFocused();

    const followUp = dialog(page).getByRole("textbox", { name: "Follow up" });
    await followUp.fill("Resolve the conflicts with main");
    await page.keyboard.press("Tab");
    await expect(dialog(page).getByRole("button", { name: "Follow up" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(followUp).toHaveValue("");
    await expect(followUp).toBeFocused();
    expect(shop.commands).toEqual(["answer-question", "follow-up"]);
  });

  test("the worker of an order keeps focus while it changes, and a second change in the meantime is undone and not sent", async ({ page }) => {
    const shop = await stageShop(page, { orders: [stagedOrder("WO-901", "in_review")], workers: ["developer", "tester"] });
    await openProject(page, PROJECT);
    await teamMember(page, "developer").click();
    await dialog(page).getByRole("button", { name: /^WO-901/ }).click();
    const worker = dialog(page).getByLabel("WORKER");
    await expect(worker).toHaveValue("developer");

    const release = shop.hold();
    await worker.focus();
    await page.keyboard.press("ArrowDown");
    await expect(worker).toHaveAttribute("aria-disabled", "true");
    await expect(worker).toBeFocused();
    await expect(worker).toHaveValue("developer");
    await page.keyboard.press("ArrowDown");
    await expect(worker).toHaveValue("developer");
    release();
    await expect(worker).toHaveValue("tester");
    await expect(worker).toBeFocused();
    expect(shop.commands).toEqual(["reassign-order"]);
  });

  test("a team change signed or discarded in the Agents panel leaves focus on the changes that remain, then on the panel's heading", async ({ page }) => {
    const shop = await stageShop(page, { teamChanges: [hire("change-1", "designer"), hire("change-2", "tester")] });
    await openProject(page, PROJECT);
    await openView(page, "Agents");
    const changes = dialog(page).getByRole("region", { name: "Team changes to sign" });
    const change = (role: string) => changes.getByRole("article").filter({ hasText: `Hire ${role}` });

    await pressWithKeyboard(change("designer").getByRole("button", { name: "Sign", exact: true }));
    await expect(change("designer")).toBeHidden();
    await expect(changes).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(change("tester").getByRole("button", { name: "Sign", exact: true })).toBeFocused();

    await pressWithKeyboard(change("tester").getByRole("button", { name: "Discard" }));
    await expect(changes).toBeHidden();
    await expect(dialog(page).getByText(/AGENTS ON THIS PROJECT/)).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toMatch(/AGENTS ON THIS PROJECT$/);
    expect(shop.commands).toEqual(["sign-team-change", "discard-team-change"]);
  });

  test("a briefing change signed in the Context panel leaves focus on the briefing it became", async ({ page }) => {
    const shop = await stageShop(page, { briefingChanges: [newBriefing("briefing-1")] });
    await openProject(page, PROJECT);
    await openView(page, "Context");

    await pressWithKeyboard(dialog(page).getByRole("button", { name: "Sign", exact: true }));
    await expect(dialog(page).getByText("Proposed: new briefing")).toBeHidden();
    await expect(dialog(page).getByRole("region", { name: "The briefing every agent reads" })).toBeFocused();
    expect(shop.commands).toEqual(["sign-briefing-change"]);
  });

  test("a message sent from a desk opened over the Agents panel lands in the chat, with the panel closed", async ({ page }) => {
    await stageShop(page, {});
    await openProject(page, PROJECT);
    await openView(page, "Agents");
    await dialog(page).getByRole("button", { name: "Customize avatar" }).first().click();
    await dialog(page).getByRole("button", { name: "Work", exact: true }).click();

    await dialog(page).getByLabel(/THE MANAGER$/).fill("Tidy the invoice footer");
    await dialog(page).getByRole("button", { name: /^Send/ }).click();

    await expect(dialog(page)).toBeHidden();
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    const box = page.getByRole("region", { name: "Your Manager" }).getByLabel("Message to the Manager");
    await box.focus();
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

test.describe("a button that is waiting", () => {
  test("does not move under a press it ignores, as one that takes the press does", async ({ page }) => {
    const shop = await stageShop(page, { orders: [stagedOrder("WO-901", "awaiting_signature")] });
    await openDesk(page);
    await page.addStyleTag({ content: "* { transition: none !important; }" });
    const nudgeUnderPress = async (button: Locator) => {
      await button.hover();
      await page.mouse.down();
      const nudge = await button.evaluate((element) => getComputedStyle(element).transform);
      await page.mouse.move(0, 0);
      await page.mouse.up();
      return nudge;
    };
    const sign = item(page, "WO-901").getByRole("button", { name: "Sign", exact: true });
    expect(await nudgeUnderPress(sign)).toBe("matrix(1, 0, 0, 1, 0, 1)");

    const release = shop.hold();
    await pressWithKeyboard(sign);
    await expect(sign).toHaveAttribute("aria-disabled", "true");
    expect(await nudgeUnderPress(sign)).toBe("none");
    release();
    await expect(item(page, "WO-901")).toBeHidden();
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

  test("say so at an agent's desk too, and send from there", async ({ page }) => {
    const shop = await stageShop(page, {});
    await openProject(page, PROJECT);
    await teamMember(page, "manager").click();

    const box = dialog(page).getByLabel("TALK TO THE MANAGER");
    await expect(box).toHaveAttribute("placeholder", /Ctrl\+Enter sends it\.$/);
    await expect(dialog(page).getByRole("button", { name: "Send", exact: true })).toHaveAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
    await box.fill("Tidy the invoice footer");
    await box.press("Enter");
    expect(shop.commands).toEqual([]);
    await box.press("Control+Enter");
    await expect(dialog(page)).toBeHidden();
    expect(shop.commands).toEqual(["send-message"]);
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
