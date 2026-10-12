import type { Locator, Page } from "@playwright/test";
import { answerInChat, closeDialog, dialog, expect, openDecisionDesk, openManagerChat, openProject, openView, tellTheManager, test } from "./support";

const PROJECT = "alpha";
const TURN = { timeout: 20_000 };

const desk = (page: Page) => page.getByRole("region", { name: "Decision desk" });
const deskTab = (page: Page, title: "To decide" | "To sign" | "Answered") => desk(page).getByRole("tab", { name: title });
const metrics = (page: Page) => page.getByRole("region", { name: "Project metrics" });

// The board columns and the cost panels are unnamed <section>s: the innermost one holding the text is the only handle.
const costTab = (page: Page, name: string) => dialog(page).getByRole("tab", { name });
const sectionWith = (page: Page, text: string | RegExp) => page.locator("section").filter({ hasText: text }).last();
const boardColumn = (page: Page, stage: string) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: stage, level: 3 }) }).last();

const questionAbout = (idea: string) => `Keep "${idea}" small, or cover the edge cases too?`;

async function orderIdOf(detail: Locator): Promise<string> {
  const eyebrow = await detail.getByText(/^ALPHA · \S+$/).innerText();
  return eyebrow.replace("ALPHA · ", "");
}

test.describe.serial("an order's life in alpha", () => {
  const idea = "Add a CSV export to the invoices page";
  const answer = "Cover edge cases";
  let orderId = "";

  test("the director's idea comes back as a question, answered at the decision desk", async ({ page }) => {
    await openProject(page, PROJECT);
    await openView(page, "Costs");
    await expect(metrics(page)).toContainText("0 questions");

    const chat = await tellTheManager(page, idea);
    await expect(chat.getByRole("article").filter({ hasText: "MANAGER" }).getByText(questionAbout(idea))).toBeVisible(TURN);
    await openView(page, "Costs");

    await expect(page.getByRole("complementary").getByRole("button", { name: PROJECT })).toHaveAccessibleName(/1 waiting for you/);
    await expect(metrics(page).getByRole("button", { name: /WAITING FOR YOU/ })).toContainText("1 to decide");
    await expect(metrics(page)).toContainText("1 question ·");
    await expect(page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Decisions" })).toContainText("1");

    await openView(page, "Decisions");
    await expect(deskTab(page, "To decide")).toHaveText(/To decide\s*1$/);
    await expect(deskTab(page, "To decide")).toHaveAttribute("aria-selected", "true");
    await expect(desk(page).getByRole("heading", { name: questionAbout(idea) })).toBeVisible();
    await expect(desk(page).getByRole("button", { name: "Send answer" })).toBeDisabled();

    await desk(page).getByRole("button", { name: answer }).click();
    await expect(desk(page).getByRole("button", { name: answer })).toHaveAttribute("aria-pressed", "true");
    await expect(desk(page).getByLabel("Your call")).toHaveValue(answer);
    await desk(page).getByRole("button", { name: "Send answer" }).click();

    await expect(deskTab(page, "To decide")).toHaveText(/To decide\s*0$/);
    await expect(deskTab(page, "To sign")).toHaveText(/To sign\s*1$/, TURN);
    await expect(deskTab(page, "To sign")).toHaveAttribute("aria-selected", "true");
  });

  test("the proposed order waits for a signature, shows its acceptance criteria and is signed", async ({ page }) => {
    await openProject(page, PROJECT);
    await openView(page, "Costs");
    await expect(metrics(page).getByRole("button", { name: /WORK ORDERS/ })).toContainText("1 to sign");

    await openView(page, "Work orders");
    await expect(boardColumn(page, "To sign").getByRole("button", { name: idea })).toContainText("To sign");

    await openView(page, "Decisions");
    await deskTab(page, "To sign").click();
    const proposal = desk(page).getByRole("article").filter({ hasText: "WORK ORDER ·" });
    await expect(proposal.getByRole("heading", { name: idea })).toBeVisible();
    await expect(proposal).toContainText(`You get what you asked for: ${idea}.`);
    await proposal.getByRole("button", { name: "Open detail" }).click();

    const detail = dialog(page);
    await expect(page.getByRole("dialog", { name: idea })).toBeVisible();
    orderId = await orderIdOf(detail);
    await expect(proposal).toContainText(`WORK ORDER · ${orderId}`);
    await expect(detail.getByRole("heading", { name: "ACCEPTANCE CRITERIA" })).toBeVisible();
    const criteria = detail.getByRole("listitem");
    await expect(criteria.filter({ hasText: "The requested behavior works end to end" })).toContainText("test: a new test covers the happy path");
    await expect(criteria.filter({ hasText: "Existing behavior does not change" })).toContainText("command: npm test passes");
    await expect(criteria.filter({ hasText: "Anything not named in the request" })).toBeVisible();

    await detail.getByRole("button", { name: "Sign", exact: true }).click();
    await expect(detail.getByRole("button", { name: "Sign", exact: true })).toBeHidden();
    await expect(detail.getByText("To sign", { exact: true })).toBeHidden();
    await closeDialog(page);

    await expect(desk(page).getByRole("heading", { name: "Nothing to sign." })).toBeVisible();
    await expect(deskTab(page, "To sign")).toHaveText(/To sign\s*0$/);
    await openView(page, "Work orders");
    await expect(boardColumn(page, "To sign")).toContainText("Nothing here.");
  });

  test("the developer's work reaches review, ready to merge, with its issue and pull request", async ({ page }) => {
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    const card = boardColumn(page, "In review").getByRole("button", { name: idea });
    await expect(card).toContainText("Ready to merge", { timeout: 30_000 });
    await expect(card).toContainText(/PR #\d+/);
    await expect(card).toContainText("$0.31");

    await card.click();
    const detail = dialog(page);
    await expect(detail).toContainText(orderId);
    await expect(detail.getByText("In review", { exact: true })).toBeVisible();
    await expect(detail.getByText("Ready to merge")).toBeVisible();
    await expect(detail.getByRole("link", { name: "Issue" })).toHaveAttribute("href", /acme\/alpha\/issues\/\d+$/);
    await expect(detail.getByRole("link", { name: "Pull request" })).toHaveAttribute("href", /acme\/alpha\/pull\/\d+$/);
  });

  test("merging delivers the order and the console records the minutes it cost", async ({ page }) => {
    await openProject(page, PROJECT);
    await openView(page, "Work orders");
    await boardColumn(page, "In review").getByRole("button", { name: idea }).click();

    const detail = dialog(page);
    await expect(detail.getByRole("heading", { name: "HOW MANY MINUTES DID IT COST YOU?" })).toBeHidden();
    await detail.getByRole("button", { name: "Merge (simulated)" }).click();

    await expect(detail.getByText("Delivered", { exact: true })).toBeVisible(TURN);
    await expect(detail.getByRole("button", { name: "Merge (simulated)" })).toBeHidden();
    await expect(detail.getByRole("heading", { name: "HOW MANY MINUTES DID IT COST YOU?" })).toBeVisible();
    await detail.getByRole("button", { name: "5 to 15" }).click();

    await expect(detail.getByText("Cost you 5 to 15 minutes.")).toBeVisible();
    await expect(detail.getByRole("heading", { name: "HOW MANY MINUTES DID IT COST YOU?" })).toBeHidden();
    await closeDialog(page);

    await expect(boardColumn(page, "Delivered").getByRole("button", { name: idea })).toContainText("Delivered");
    await expect(boardColumn(page, "Delivered").getByRole("button", { name: idea })).not.toContainText("Ready to merge");
    await expect(boardColumn(page, "In review")).toContainText("Nothing here.");
    await openView(page, "Costs");
    await expect(metrics(page).getByRole("button", { name: /WORK ORDERS/ })).toContainText("1 delivered");
  });

  test("costs, activity and the answered questions keep what happened", async ({ page }) => {
    await openProject(page, PROJECT);

    await openView(page, "Costs");
    await expect(dialog(page).getByRole("list", { name: "Spent per day, last 14 days" }).getByRole("listitem")).toHaveCount(14);
    await costTab(page, "Run history").click();
    const runs = page.getByRole("row");
    const developerRun = runs.filter({ hasText: orderId }).filter({ hasText: "codex" });
    await expect(developerRun).toHaveCount(1);
    await expect(developerRun).toContainText("developer");
    await expect(developerRun).toContainText("Completed");
    await expect(developerRun).toContainText("212k in · 6.8k out");
    await expect(developerRun).toContainText("$0.31");
    const managerRuns = runs.filter({ hasText: "18.4k in · 320 out" });
    await expect(managerRuns).toHaveCount(2);
    await expect(managerRuns.first()).toContainText("manager");
    await expect(managerRuns.first()).toContainText("claude");
    await expect(managerRuns.first()).toContainText("Completed");

    const totals = sectionWith(page, "Everything the agents spent on alpha.");
    await expect(totals).toContainText(/Input tokens\s*248\.8k/);
    await expect(totals).toContainText(/of which cached\s*217\.2k/);
    await expect(totals).toContainText(/Output tokens\s*7\.4k/);
    await costTab(page, "Per work order").click();
    await expect(dialog(page).getByRole("row").filter({ hasText: orderId })).toContainText("$0.31");
    await costTab(page, "Per agent").click();
    await expect(dialog(page).getByRole("row").filter({ hasText: "developer" })).toContainText("$0.31");

    await openView(page, "Activity");
    const trail = page.getByRole("article").filter({ hasText: orderId });
    for (const step of [
      `proposed: ${idea}`,
      "signed by the director",
      "work started",
      /issue #\d+ opened/,
      /pull request #\d+ opened/,
      /in review, pull request #\d+/,
      "developer run finished, $0.31",
      "cost the director 5-15 minutes",
    ]) {
      await expect(trail.filter({ hasText: step })).toHaveCount(1);
    }
    await expect(trail.getByText("delivered", { exact: true })).toHaveCount(1);
    await expect(trail.getByRole("link", { name: /issue #\d+ opened/ })).toHaveAttribute("href", /acme\/alpha\/issues\/\d+$/);

    await openView(page, "Decisions");
    await expect(deskTab(page, "Answered")).toHaveText(/Answered\s*1$/);
    await deskTab(page, "Answered").click();
    const answered = desk(page).getByRole("article").filter({ hasText: questionAbout(idea) });
    await expect(answered).toContainText("The Manager asked");
    await expect(answered).toContainText(`Your call${answer}`);
  });
});

test("a discarded order leaves the signing queue and never reaches a developer", async ({ page }) => {
  const idea = "Rename the settings page";
  await openProject(page, PROJECT);

  const chat = await tellTheManager(page, idea);
  await answerInChat(chat, "Keep it small", TURN);
  await openDecisionDesk(page);

  await openView(page, "Decisions");
  await deskTab(page, "To sign").click();
  await expect(deskTab(page, "To sign")).toHaveText(/To sign\s*1$/, TURN);
  const proposal = desk(page).getByRole("article").filter({ hasText: "WORK ORDER ·" });
  const orderId = (await proposal.getByText(/^WORK ORDER · \S+$/).innerText()).replace("WORK ORDER · ", "");
  await proposal.getByRole("button", { name: "Discard" }).click();

  await expect(desk(page).getByRole("heading", { name: "Nothing to sign." })).toBeVisible();
  await expect(deskTab(page, "To sign")).toHaveText(/To sign\s*0$/);

  await openView(page, "Work orders");
  await expect(boardColumn(page, "Discarded").getByRole("button", { name: orderId })).toContainText("Discarded");
  await expect(boardColumn(page, "To sign")).toContainText("Nothing here.");
  await expect(boardColumn(page, "On the bench")).toContainText("Nothing here.");

  const afterwards = await tellTheManager(page, "/ping");
  await expect(afterwards.getByText("Nothing on the bench but the paperwork.")).toBeVisible(TURN);
  await openDecisionDesk(page);

  await openView(page, "Activity");
  const trail = page.getByRole("article").filter({ hasText: orderId });
  await expect(trail.getByText("discarded", { exact: true })).toHaveCount(1);
  await expect(trail.getByText("signed by the director")).toHaveCount(0);
  await expect(trail.filter({ hasText: "work started" })).toHaveCount(0);
  await expect(trail.filter({ hasText: /run/ })).toHaveCount(0);

  await openView(page, "Costs");
  await costTab(page, "Run history").click();
  await expect(page.getByRole("row").filter({ hasText: "codex" }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: orderId })).toHaveCount(0);

  await openView(page, "Work orders");
  await boardColumn(page, "Discarded").getByRole("button", { name: orderId }).click();
  await expect(dialog(page).getByRole("button", { name: "Sign", exact: true })).toBeHidden();
  await expect(dialog(page).getByText("Discarded", { exact: true })).toBeVisible();
});

test.describe("the static pages", () => {
  const pages = [
    { path: "/design", heading: /One studio\.\s*Many minds\./ },
    { path: "/github/", heading: /Your judgment\.\s*A team\s*of agents\./ },
    { path: "/github/organization/", heading: /skynot\s*\/ labs\./ },
    { path: "/github/app/", heading: /From the studio\s*to the repository\./ },
  ];

  for (const { path, heading } of pages) {
    test(`${path} shows its main heading`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    });
  }

  test("a page in a folder is reached without its trailing slash too", async ({ page }) => {
    await page.goto("/github/app");
    await expect(page).toHaveURL(/\/github\/app\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(pages[3]!.heading);
  });

  test("the console opens on the first project and links to the design page and the GitHub kit", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("alpha");
    await page.getByRole("link", { name: "Identity and design", exact: true }).click();
    await expect(page).toHaveURL(/\/design$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(pages[0]!.heading);

    await page.goto("/");
    await page.getByRole("link", { name: "GitHub kit" }).click();
    await expect(page).toHaveURL(/\/github\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(pages[1]!.heading);
  });
});

test("a question the chat has moved past stays pinned above it until it is answered", async ({ page }) => {
  // The simulated Manager asks about the conversation's first idea, whatever the latest message says.
  const question = /small, or cover the edge cases too\?$/;
  await openProject(page, PROJECT);
  const chat = await tellTheManager(page, "Add a dark theme");
  await expect(chat.locator(".chat-question").getByText(question)).toBeVisible(TURN);
  const pinned = chat.getByRole("group", { name: "Open questions" });
  await expect(pinned).toBeHidden();

  await chat.getByLabel("Message to the Manager").fill("/ping");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByText("Nothing on the bench but the paperwork.").last()).toBeVisible(TURN);
  await expect(pinned.getByRole("button")).toHaveText(question);

  await pinned.getByRole("button").click();
  await answerInChat(chat, "Keep it small", TURN);
  await expect(chat.getByText("That settles it. Filing the order.").last()).toBeVisible(TURN);
  await expect(pinned).toBeHidden();
  await openDecisionDesk(page);

  await openView(page, "Decisions");
  await deskTab(page, "To sign").click();
  await desk(page).getByRole("article").filter({ hasText: "WORK ORDER ·" }).getByRole("button", { name: "Discard" }).click();
  await expect(desk(page).getByRole("heading", { name: "Nothing to sign." })).toBeVisible();
});

test("a plan of two orders is signed once, and the second waits for the first", async ({ page }) => {
  const wanted = "a PDF copy of each invoice";
  await openProject(page, PROJECT);

  const chat = await tellTheManager(page, `/plan ${wanted}`);
  const plan = chat.getByRole("article").filter({ hasText: "2 ORDERS, IN THIS SEQUENCE" });
  await expect(plan.getByText(`Lay the ground for ${wanted}`, { exact: true })).toBeVisible(TURN);
  await expect(plan.getByText(`Build ${wanted}`, { exact: true })).toBeVisible();
  await expect(plan.getByRole("button", { name: "Sign", exact: true })).toHaveCount(0);

  await plan.getByRole("button", { name: "Sign the plan" }).click();
  await expect(plan.getByRole("button", { name: "Sign the plan" })).toBeHidden();

  await openView(page, "Work orders");
  await expect(boardColumn(page, "To sign")).toContainText("Nothing here.");
  const second = dialog(page).getByRole("button", { name: `Build ${wanted}` });
  await expect(second).toContainText(/Waiting for WO-\d+/);
  await expect(dialog(page).getByRole("button", { name: `Lay the ground for ${wanted}` })).not.toContainText("Waiting for");
});
