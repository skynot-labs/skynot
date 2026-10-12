import type { Locator, Page } from "@playwright/test";
import { commandPath, type Order, type State } from "@skynot/contract";
import { dialog, expect, openDecisionDesk, openManagerChat, openProject, openView, orderToSign, paintsOnTop, stageState, tellTheManager, test } from "./support";

const PROJECT = "alpha";
const TURN = { timeout: 20_000 };
const UNBROKEN = "W".repeat(80);
const AT = "2026-01-01T00:00:00.000Z";
const REFUSAL = "the daily cost cap of $10.00 was reached ($10.02 spent), so nothing new is signed until the cap is raised in policy.yaml or the day ends";

const desk = (page: Page) => page.getByRole("region", { name: "Decision desk" });
const boardColumn = (page: Page, stage: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: stage, level: 3 }) }).last();
const panel = (page: Page, title: string) => page.locator("section").filter({ has: page.getByText(title, { exact: true }) }).last();

// The simulated shop never has a run in progress, a review with findings or a title that long, so those are staged, and only for this spec's project.
const stage = (page: Page, change: (state: State) => void) =>
  stageState(page, (state) => {
    if (state.project.id === PROJECT) change(state);
  });

const stageOrder = (page: Page, orderId: string, changes: Partial<Order>) =>
  stage(page, (state) => {
    Object.assign(state.orders.find((order) => order.id === orderId)!, changes);
  });

async function boxOf(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = (await locator.boundingBox())!;
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height, width: box.width };
}

async function expectInside(inner: Locator, outer: Locator): Promise<void> {
  const [control, frame] = [await boxOf(inner), await boxOf(outer)];
  const viewport = inner.page().viewportSize()!.width;
  expect(control.left).toBeGreaterThanOrEqual(Math.max(0, frame.left));
  expect(control.right).toBeLessThanOrEqual(Math.min(viewport, frame.right));
}

test.describe.serial("a work order on every surface that shows it", () => {
  const idea = "Tidy the invoice footer";
  let orderId = "";

  test.beforeEach(async ({ page }, info) => {
    // The first case files its order through the chat; every other one finds an order to sign or has the office file one.
    if (!info.title.startsWith("an option in the chat")) orderId = await orderToSign(page, PROJECT);
  });

  test("an option in the chat fills the answer, and the director sends it", async ({ page }) => {
    const answers: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith(commandPath("answer-decision"))) answers.push(request.url());
    });
    await openProject(page, PROJECT);
    const chat = await tellTheManager(page, idea);
    const question = chat.locator(".chat-question");
    await question.getByRole("button", { name: "Keep it small" }).click(TURN);

    await expect(question.getByRole("button", { name: "Keep it small" })).toHaveAttribute("aria-pressed", "true");
    await expect(question.getByRole("textbox")).toHaveValue("Keep it small");
    await question.getByRole("button", { name: "Cover edge cases" }).click();
    await expect(question.getByRole("textbox")).toHaveValue("Cover edge cases");
    expect(answers).toEqual([]);

    await question.getByRole("button", { name: "Answer", exact: true }).click();
    await expect(chat.getByText("That settles it. Filing the order.").last()).toBeVisible(TURN);
    expect(answers).toHaveLength(1);

    const card = chat.locator(".chat-order").last();
    await expect(card.getByRole("button", { name: "Sign", exact: true })).toBeVisible(TURN);
    await expect(card).toContainText(await orderToSign(page, PROJECT));
  });

  test("a row of work in motion says the order's status in words and opens the order", async ({ page }) => {
    await stage(page, (state) => {
      state.orders.sort((a, b) => Number(b.id === orderId) - Number(a.id === orderId));
    });
    await openProject(page, PROJECT);
    await openDecisionDesk(page);
    const row = panel(page, "Work in motion").getByRole("button", { name: orderId });
    await expect(row).toContainText("To sign");

    await row.click();
    await expect(dialog(page).getByText(`ALPHA · ${orderId}`)).toBeVisible();
    await expect(dialog(page).getByRole("heading", { name: "ACCEPTANCE CRITERIA" })).toBeVisible();
  });

  test("a search that matches no order says so and offers to clear it", async ({ page }) => {
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    const board = dialog(page);
    await board.getByLabel("Search work orders").fill("no-such-order");

    await expect(board.getByText("No work order matches “no-such-order”.")).toBeVisible();
    await expect(board.getByText("Nothing here.")).toHaveCount(0);
    await expect(board.getByRole("heading", { name: "To sign", level: 3 })).toBeHidden();

    await board.getByRole("button", { name: "Clear the search" }).click();
    await expect(board.getByLabel("Search work orders")).toHaveValue("");
    await expect(boardColumn(page, "To sign").getByRole("button", { name: orderId })).toBeVisible();
  });

  for (const width of [390, 1440]) {
    test(`a title of one 80-character word keeps every control in view at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await stageOrder(page, orderId, { title: UNBROKEN });
      await openProject(page, PROJECT);

      const chat = await openManagerChat(page);
      const message = chat.getByRole("article").filter({ hasText: orderId });
      await expectInside(message.getByRole("button", { name: "Sign", exact: true }), message);
      await expectInside(message.getByRole("button", { name: "Open the brief" }), message);

      await openDecisionDesk(page);
      await openView(page, "Decisions");
      await desk(page).getByRole("tab", { name: "To sign" }).click();
      const proposal = desk(page).getByRole("article").filter({ hasText: `WORK ORDER · ${orderId}` });
      await expectInside(proposal.getByRole("heading", { name: UNBROKEN }), proposal);
      await expectInside(proposal.getByRole("button", { name: "Discard" }), proposal);

      await openView(page, "Work orders");
      const card = boardColumn(page, "To sign").getByRole("button", { name: orderId });
      await expectInside(card.getByText("To sign", { exact: true }), card);
      await expectInside(card.getByText("$0.00"), card);
      await expectInside(card, dialog(page));
    });
  }

  test("an order being worked right now says so on its card and in its detail", async ({ page }) => {
    await stage(page, (state) => {
      Object.assign(state.orders.find((order) => order.id === orderId)!, { status: "on_bench", working: true, signedAt: AT });
      state.presence.working.push({ runId: "run_staged", role: "developer", engine: "claude", orderId, since: AT });
    });
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    const card = boardColumn(page, "On the bench").getByRole("button", { name: orderId });
    await expect(card).toContainText("On the bench · working");

    await card.click();
    await expect(dialog(page).getByText("On the bench · working", { exact: true })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Stop" })).toBeVisible();
  });

  test("an order being worked says so on one line of its card with five columns on the board, and in the costs", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stage(page, (state) => {
      const order = state.orders.find((candidate) => candidate.id === orderId)!;
      Object.assign(order, { status: "on_bench", working: true, signedAt: AT, spentUsd: 1.5 });
      state.orders.push({ ...order, id: "WO-9999", status: "discarded", working: false });
      state.presence.working.push({ runId: "run_staged", role: "developer", engine: "claude", orderId, since: AT });
    });
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    await expect(dialog(page).getByRole("heading", { name: "Discarded", level: 3 })).toBeVisible();
    const card = boardColumn(page, "On the bench").getByRole("button", { name: orderId });
    const chip = card.getByText("On the bench · working", { exact: true });
    const lines = await chip.evaluate((element) => {
      const text = document.createRange();
      text.selectNodeContents(element);
      return text.getClientRects().length;
    });
    expect(lines).toBe(1);
    await expectInside(chip, card);

    await openView(page, "Costs");
    await expect(dialog(page).getByRole("row").filter({ hasText: orderId })).toContainText("On the bench · working");
  });

  test("the detail lines its criteria up with their heading and gives a failing check its own line", async ({ page }) => {
    await stageOrder(page, orderId, {
      status: "in_review",
      signedAt: AT,
      checks: "failing",
      review: { verdict: "changes_requested", summary: "Two things.", findings: ["The footer overlaps the total"], diffOnly: false },
    });
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    await boardColumn(page, "In review").getByRole("button", { name: orderId }).click();
    const detail = dialog(page);

    const heading = await boxOf(detail.getByRole("heading", { name: "ACCEPTANCE CRITERIA" }));
    const criterion = await boxOf(detail.getByRole("listitem").filter({ hasText: "The requested behavior works end to end" }));
    expect(criterion.left).toBeCloseTo(heading.left, 0);

    const notice = await boxOf(detail.locator(".order-notice").filter({ hasText: "Reviewer asks for changes." }));
    const checks = await boxOf(detail.getByText("checks failing", { exact: true }));
    expect(checks.top - notice.bottom).toBeGreaterThanOrEqual(8);
  });

  test("a team change and a briefing change read the same in their own panels as at the desk", async ({ page }) => {
    await stage(page, (state) => {
      state.teamChanges = [{ id: "chg_0001", action: "refocus", role: "developer", reason: "The invoices need care.", focus: "Billing", status: "pending", proposedAt: AT }];
      state.briefingChanges = [{ id: "brf_0001", projectId: PROJECT, text: "We ship invoices.", reason: "The briefing was empty.", status: "pending", proposedAt: AT }];
    });
    await openProject(page, PROJECT);
    await openDecisionDesk(page);
    await openView(page, "Decisions");
    await desk(page).getByRole("tab", { name: "To sign" }).click();

    for (const [view, title] of [["Agents", "Refocus developer"], ["Context", "New briefing"]] as const) {
      const proposal = (within: Locator) => within.getByRole("article").filter({ has: page.getByRole("heading", { name: title }) });
      await openView(page, view);
      const inPanel = proposal(dialog(page));
      await expect(inPanel.getByRole("button")).toHaveText(["Sign", "Discard"]);
      await expect(inPanel.getByRole("button")).toHaveText(await proposal(desk(page)).getByRole("button").filter({ hasText: /^(Sign|Discard)$/ }).allInnerTexts());

      const [sign, discard] = [await boxOf(inPanel.getByRole("button", { name: "Sign" })), await boxOf(inPanel.getByRole("button", { name: "Discard" }))];
      expect(discard.width).toBeLessThan(sign.width);
      await expect(inPanel.getByRole("button", { name: "Discard" })).toHaveClass(/danger-button/);
      await expect(proposal(desk(page)).getByRole("button", { name: "Discard" })).toHaveClass(/danger-button/);
    }
  });

  test("a studio where nothing has happened yet says what will appear, and marks no state it does not have", async ({ page }) => {
    await stage(page, (state) => {
      state.activity = [];
    });
    await openProject(page, PROJECT);
    await openDecisionDesk(page);

    await expect(panel(page, "In the studio")).toContainText("What the team does will land here as it happens.");
    await expect(page.getByText("PRESENCE", { exact: true })).toHaveCount(0);
  });

  for (const [width, height] of [[390, 844], [1440, 900]] as const) {
    test(`a signature the office refuses is said inside the order, and leaves Sign and Discard to click at ${width}`, async ({ page, browserErrors }) => {
      await page.setViewportSize({ width, height });
      await stageOrder(page, orderId, { approach: Array.from({ length: 14 }, (_, step) => `Step ${step + 1} of the long way round the footer.`) });
      await page.route(`**${commandPath("sign-order")}`, (route) => route.fulfill({ status: 409, json: { error: REFUSAL } }));
      await openProject(page, PROJECT);
      await openView(page, "Work orders");
      await boardColumn(page, "To sign").getByRole("button", { name: orderId }).click();
      const detail = dialog(page);
      await detail.getByRole("button", { name: "Sign", exact: true }).click();

      const refusal = detail.getByRole("alert").filter({ hasText: `The office refused: ${REFUSAL}.` });
      await expect(refusal).toBeVisible();
      for (const name of ["Sign", "Discard"]) {
        const control = detail.getByRole("button", { name, exact: true });
        await control.scrollIntoViewIfNeeded();
        expect(await paintsOnTop(control), `${name} takes the click`).toBe(true);
        await expect(refusal).toBeInViewport();
        expect(await paintsOnTop(refusal)).toBe(true);
      }
      expect(browserErrors.splice(0)).toEqual([expect.stringContaining("409")]);
    });
  }

  test("discard stands apart from sign in the detail, and one click is final", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    await boardColumn(page, "To sign").getByRole("button", { name: orderId }).click();
    const detail = dialog(page);

    const [discard, sign] = [await boxOf(detail.getByRole("button", { name: "Discard" })), await boxOf(detail.getByRole("button", { name: "Sign", exact: true }))];
    expect(sign.left - discard.right).toBeGreaterThan(200);
    await expect(detail.getByRole("button", { name: "Discard" })).toHaveClass(/danger-button/);

    await detail.getByRole("button", { name: "Discard" }).click();
    await expect(detail.getByText("Discarded", { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Discard" })).toBeHidden();
    await expect(detail.getByRole("button", { name: "Sign", exact: true })).toBeHidden();
  });
});
