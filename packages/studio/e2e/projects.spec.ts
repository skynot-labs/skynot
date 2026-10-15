import type { Browser, Locator, Page } from "@playwright/test";
import { closeDialog, dialog, expect, openManagerChat, openProject, openView, paintsOnTop, stageState, test } from "./support";

declare global {
  interface Window {
    alertsMounted: number;
  }
}

const LEGACY_STUDIOS_KEY = "skynot-studios-v1";
const PAUSE_REASON = "paused by the director";
const CAP_REASON = "the daily cost cap of $10.00 was reached ($10.02 spent)";
const MANAGER_TURN = { timeout: 20_000 };
// Known defect, pinned by its own test below; the registration flow must not fail on it a second time.

const sidebar = (page: Page): Locator => page.getByRole("complementary");
const projectEntry = (page: Page, name: string): Locator => sidebar(page).getByRole("button", { name });
const studio = (page: Page, name: string): Locator => page.getByRole("region", { name: `${name} studio` });
const studioHeading = (page: Page): Locator => page.getByRole("heading", { level: 1 });
const breadcrumb = (page: Page): Locator => page.getByRole("banner");
const toast = (page: Page, text: string): Locator => page.getByRole("status").filter({ hasText: text });
const failure = (page: Page, text: string): Locator => page.getByRole("alert").filter({ hasText: text });
const dismissal = (notice: Locator): Locator => notice.getByRole("button", { name: "Dismiss this notice" });
const pauseControl = (page: Page, label: string): Locator => page.getByRole("group", { name: "Pause" }).getByRole("button", { name: label });
const metrics = (page: Page): Locator => page.getByRole("region", { name: "Project metrics" });
const managerCard = (page: Page): Locator => page.getByRole("article").filter({ has: page.getByRole("heading", { name: "manager" }) });
const place = (page: Page, name: string): Locator => page.getByRole("dialog").getByRole("group", { name: "01 / PLACE" }).getByRole("button", { name });
const roster = (page: Page): Locator => page.getByRole("region", { name: "Project team" });
// Panels carry no accessible name, and the view that holds them is a section too: the innermost match is the panel.
const panel = (page: Page, title: string): Locator => page.locator("section").filter({ has: page.getByText(title, { exact: true }) }).last();

// An alert is spoken when it enters the page, so each one that enters is one announcement.
async function countAlerts(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    window.alertsMounted = 0;
    new MutationObserver((changes) => {
      for (const change of changes)
        for (const node of change.addedNodes)
          if (node instanceof Element && (node.matches("[role=alert]") || node.querySelector("[role=alert]"))) window.alertsMounted++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => window.alertsMounted);
}

async function editProfile(page: Page): Promise<{ name: Locator; description: Locator }> {
  await openView(page, "Context");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  return { name: page.getByLabel("NAME", { exact: true }), description: page.getByLabel(/^DESCRIPTION/) };
}

async function visitInFreshBrowser(
  browser: Browser,
  baseURL: string | undefined,
  visit: (page: Page) => Promise<void>,
  legacyStorage: Record<string, string> = {},
): Promise<string[]> {
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  try {
    await context.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, legacyStorage);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await visit(page);
    return errors;
  } finally {
    await context.close();
  }
}

test.describe.serial("the director's projects", () => {
  test("switches project and keeps the choice across a reload", async ({ page }) => {
    await page.goto("/");
    await expect(projectEntry(page, "alpha")).toBeVisible();
    await expect(projectEntry(page, "beta")).toBeVisible();
    await expect(studio(page, "alpha")).toBeVisible();

    await projectEntry(page, "beta").click();
    await expect(studioHeading(page)).toHaveText("The beta studio.");
    await expect(studio(page, "beta")).toContainText("acme/beta");
    await expect(studio(page, "alpha")).toBeHidden();
    await expect(breadcrumb(page)).toContainText("beta");

    await page.reload();
    await expect(studioHeading(page)).toHaveText("The beta studio.");
    await expect(studio(page, "beta")).toBeVisible();
  });

  test("shows nothing of the project just left while the next one loads", async ({ page }) => {
    await page.goto("/");
    await expect(studio(page, "alpha")).toBeVisible();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/state?project=beta", async (route) => {
      await held;
      await route.continue();
    });

    await projectEntry(page, "beta").click();
    await expect(studio(page, "alpha")).toBeHidden();

    release();
    await expect(studio(page, "beta")).toBeVisible();
  });

  test("renames and describes a project, and falls back to the repository's name", async ({ page }) => {
    await openProject(page, "beta");

    const tooLong = await editProfile(page);
    await tooLong.name.clear();
    await tooLong.name.pressSequentially("n".repeat(70));
    await expect(tooLong.name).toHaveValue("n".repeat(60));
    await tooLong.description.pressSequentially("d".repeat(290));
    await expect(tooLong.description).toHaveValue("d".repeat(280));
    await expect(page.getByText("DESCRIPTION · 280/280")).toBeVisible();

    await tooLong.name.fill("Beta Storefront");
    await tooLong.description.fill("Where the second shop sells its goods.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(projectEntry(page, "Beta Storefront")).toBeVisible();
    await expect(breadcrumb(page)).toContainText("Beta Storefront");
    await expect(panel(page, "Project")).toContainText("Where the second shop sells its goods.");
    await openView(page, "The studio");
    await expect(studioHeading(page)).toHaveText("The Beta Storefront studio.");
    await expect(breadcrumb(page)).toContainText("Where the second shop sells its goods.");

    const cleared = await editProfile(page);
    await cleared.name.clear();
    await cleared.description.clear();
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(projectEntry(page, "beta")).toBeVisible();
    await expect(projectEntry(page, "Beta Storefront")).toHaveCount(0);
    await expect(breadcrumb(page)).toContainText("beta");
    await expect(breadcrumb(page)).not.toContainText("Storefront");
    await expect(panel(page, "Project")).toContainText("No description yet.");
    await openView(page, "The studio");
    await expect(studioHeading(page)).toHaveText("The beta studio.");
  });

  test("pauses one project: its Manager waits until it is resumed, and the other project keeps going", async ({ page }) => {
    await openProject(page, "beta");
    await pauseControl(page, "Pause this project").click();

    await expect(studio(page, "beta").getByRole("status")).toContainText(`This project is paused · ${PAUSE_REASON}`);
    await expect(page.getByRole("status").filter({ hasText: "This project is paused" })).toHaveCount(1);
    await expect(pauseControl(page, "Resume this project")).toBeVisible();
    await expect(projectEntry(page, "beta")).toContainText("PAUSED");
    await expect(projectEntry(page, "beta")).toHaveAttribute("title", "acme/beta · paused");
    await expect(projectEntry(page, "alpha")).not.toContainText("PAUSED");

    await openView(page, "Context");
    const pauseCard = panel(page, "This project's work");
    await expect(pauseCard).toContainText("PAUSED");
    await expect(pauseCard).toContainText(PAUSE_REASON);
    await expect(pauseCard).toContainText("Paused since");

    await openView(page, "The studio");
    const chat = await openManagerChat(page);
    await chat.getByRole("textbox", { name: "Message to the Manager" }).fill("/ping is anything on the bench?");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByRole("article")).toHaveText(/ping is anything on the bench\?/);
    await expect(chat.getByRole("status")).toHaveText("The Manager's turn is waiting in line.");

    await openView(page, "Agents");
    await expect(managerCard(page)).toContainText("In line · number 1");
    await openView(page, "Costs");
    await expect(metrics(page)).toContainText("1 queued · project paused");
    await expect(metrics(page)).toContainText("0 / 2 agents");

    await page.reload();
    await openView(page, "Agents");
    await expect(managerCard(page)).toContainText("In line · number 1");
    await expect(managerCard(page)).not.toContainText("Working");
    const stillWaiting = await openManagerChat(page);
    await expect(stillWaiting.getByRole("article")).toHaveCount(1);
    await expect(stillWaiting).not.toContainText("Nothing on the bench");

    await projectEntry(page, "alpha").click();
    await expect(studio(page, "alpha")).toBeVisible();
    await expect(pauseControl(page, "Pause this project")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "is paused" })).toHaveCount(0);
    await openView(page, "Costs");
    await expect(metrics(page)).not.toContainText("paused");
    await openView(page, "The studio");
    await expect(projectEntry(page, "alpha")).toHaveAttribute("title", "acme/alpha");

    await projectEntry(page, "beta").click();
    await pauseControl(page, "Resume this project").click();
    await expect(pauseControl(page, "Pause this project")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "is paused" })).toHaveCount(0);
    await expect(projectEntry(page, "beta")).not.toContainText("PAUSED");

    const answered = await openManagerChat(page);
    await expect(answered.getByRole("article").filter({ hasText: "MANAGER" })).toContainText("Nothing on the bench but the paperwork.", MANAGER_TURN);
    await openView(page, "Agents");
    await expect(managerCard(page)).toContainText("Available", MANAGER_TURN);
  });

  test("registers a project on this machine from a spec, and refuses a file that is not one", async ({ browser, baseURL }) => {
    await visitInFreshBrowser(browser, baseURL, async (page) => {
      await page.goto("/");
      await sidebar(page).getByRole("button", { name: "Register a project" }).click();
      const form = dialog(page);
      await form.getByLabel("ID", { exact: true }).fill("listo");
      await form.getByLabel("On this machine, from nothing").check();
      await expect(form.getByLabel("REPOSITORY")).toHaveCount(0);
      await expect(form.getByLabel(/^VERIFY COMMANDS/)).toHaveValue("true");

      const spec = form.getByLabel(/^SPEC/);
      await spec.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from("not a spec") });
      await expect(form.getByRole("alert")).toHaveText("A spec is a .md, .markdown or .txt file.");
      await expect(form.getByRole("button", { name: "Register the project" })).toBeDisabled();

      await spec.setInputFiles({ name: "SPEC.md", mimeType: "text/markdown", buffer: Buffer.from("# Listo\n\nA todo app people pay for.\n") });
      await expect(form.getByRole("alert")).toHaveCount(0);
      await form.getByRole("button", { name: "Register the project" }).click();

      await expect(form.getByRole("status")).toContainText("listo was written to the projects folder.");
    });
  });

  test("registers a project for the next restart and refuses a repository already served", async ({ browser, baseURL }) => {
    const errors = await visitInFreshBrowser(browser, baseURL, async (page) => {
      await page.goto("/");
      await sidebar(page).getByRole("button", { name: "Register a project" }).click();
      const form = dialog(page);
      await form.getByLabel("ID", { exact: true }).fill("gamma");
      await form.getByLabel("REPOSITORY").fill("acme/gamma");
      await form.getByLabel(/^VERIFY COMMANDS/).fill("npm test");
      await form.getByRole("button", { name: "Register the project" }).click();

      await expect(form.getByRole("status")).toContainText("gamma was written to the projects folder.");
      await expect(form).toContainText("It starts with the next restart of the office: stop it and start it again the way you started it, npm run start in a terminal or a restart of its service on a server. Until then it does not appear in the project list.");
      await form.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(projectEntry(page, "gamma")).toHaveCount(0);
      await page.reload();
      await expect(projectEntry(page, "beta")).toBeVisible();
      await expect(projectEntry(page, "gamma")).toHaveCount(0);

      await sidebar(page).getByRole("button", { name: "Register a project" }).click();
      const refused = dialog(page);
      await refused.getByLabel("ID", { exact: true }).fill("delta");
      await refused.getByLabel("REPOSITORY").fill("ACME/Alpha");
      await refused.getByLabel(/^VERIFY COMMANDS/).fill("npm run verify");
      await refused.getByRole("button", { name: "Register the project" }).click();

      const refusal = failure(page, "The office refused: acme/alpha already belongs to the project alpha: a repository belongs to one project.");
      await expect(refusal).toBeVisible();
      expect(await paintsOnTop(refusal)).toBe(true);
      await expect(refused.getByText("was written to the projects folder")).toHaveCount(0);
      await expect(refused.getByLabel("ID", { exact: true })).toHaveValue("delta");
      await expect(refused.getByLabel("REPOSITORY")).toHaveValue("ACME/Alpha");
      await expect(refused.getByLabel(/^VERIFY COMMANDS/)).toHaveValue("npm run verify");

      await page.waitForTimeout(6000);
      await expect(refusal).toBeVisible();
      await dismissal(refusal).click();
      await expect(refusal).toBeHidden();
    });
    expect(errors).toEqual([expect.stringContaining("409")]);
  });

  test("the registration form's id rule is one the browser can enforce", async ({ page }) => {
    await page.goto("/");
    await sidebar(page).getByRole("button", { name: "Register a project" }).click();
    const id = dialog(page).getByLabel("ID", { exact: true });
    await id.fill("Not An Id");
    expect(await id.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true);
  });

  test("a command the office never got is reported above the open panel until the director dismisses it", async ({ page, browserErrors }) => {
    await openProject(page, "beta");
    await openView(page, "Context");
    await page.route("**/api/commands/pause-project", (route) => route.abort());
    await panel(page, "This project's work").getByRole("button", { name: "Pause this project" }).click();

    const unsent = failure(page, "The command was not sent.");
    await expect(unsent).toBeVisible();
    expect(await paintsOnTop(unsent)).toBe(true);
    await dismissal(unsent).click();
    await expect(unsent).toBeHidden();
    await expect(panel(page, "This project's work")).not.toContainText("PAUSED");
    expect(browserErrors.splice(0)).toEqual([expect.stringContaining("pause-project")]);
  });

  test("a refusal with nothing open takes its own room above the office, and leaves the zone buttons to click", async ({ page, browserErrors }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProject(page, "beta");
    await page.route("**/api/commands/pause-project", (route) => route.abort());
    await pauseControl(page, "Pause this project").click();

    const unsent = failure(page, "The command was not sent.");
    await expect(unsent).toBeVisible();
    for (const zone of await page.getByRole("navigation", { name: "Studio zones" }).getByRole("button").all()) {
      await zone.scrollIntoViewIfNeeded();
      expect(await paintsOnTop(zone), `${await zone.innerText()} takes the click`).toBe(true);
    }
    await page.evaluate(() => scrollTo(0, 0));
    const [notice, office] = [(await unsent.boundingBox())!, (await studio(page, "beta").boundingBox())!];
    expect(notice.y + notice.height).toBeLessThanOrEqual(office.y);
    expect(browserErrors.splice(0)).toEqual([expect.stringContaining("pause-project")]);
  });

  test("a failure that happens again is announced again, and is gone once the command goes through", async ({ page, browserErrors }) => {
    await openProject(page, "beta");
    let reachable = false;
    await page.route("**/api/commands/pause-project", (route) => (reachable ? route.continue() : route.abort()));
    const announced = await countAlerts(page);
    const unsent = failure(page, "The command was not sent.");

    await pauseControl(page, "Pause this project").click();
    await expect(unsent).toBeVisible();
    expect(await announced()).toBe(1);
    await pauseControl(page, "Pause this project").click();
    await expect.poll(announced).toBe(2);
    await expect(unsent).toHaveCount(1);

    reachable = true;
    await pauseControl(page, "Pause this project").click();
    await expect(pauseControl(page, "Resume this project")).toBeVisible();
    await expect(unsent).toHaveCount(0);
    await pauseControl(page, "Resume this project").click();
    await expect(pauseControl(page, "Pause this project")).toBeVisible();
    expect(browserErrors.splice(0)).toEqual([expect.stringContaining("pause-project"), expect.stringContaining("pause-project")]);
  });

  test("a failure is announced once, and follows the director into a dialog and out of it", async ({ page, browserErrors }) => {
    await openProject(page, "beta");
    await page.route("**/api/commands/pause-project", (route) => route.abort());
    const announced = await countAlerts(page);
    await pauseControl(page, "Pause this project").click();
    await expect(failure(page, "The command was not sent.")).toBeVisible();

    await page.getByRole("button", { name: "Style the studio" }).click();
    const inDialog = dialog(page).getByText("The command was not sent.");
    await expect(inDialog).toBeVisible();
    expect(await paintsOnTop(inDialog)).toBe(true);
    await closeDialog(page);
    const inShell = page.getByText("The command was not sent.");
    await expect(inShell).toBeVisible();
    expect(await announced()).toBe(1);
    await expect(page.getByRole("main").getByText("The command was not sent.")).toBeVisible();

    await dismissal(page.getByRole("main")).first().click();
    await expect(inShell).toHaveCount(0);
    expect(browserErrors.splice(0)).toEqual([expect.stringContaining("pause-project")]);
  });

  test("a look the office never got keeps its dialog open with what was chosen", async ({ page, browserErrors }) => {
    await openProject(page, "beta");
    await page.route("**/api/commands/set-preference", (route) => route.abort());
    await roster(page).getByRole("button", { name: "developer" }).click();
    await dialog(page).getByRole("button", { name: "Look", exact: true }).click();
    await dialog(page).getByLabel("DISPLAY ALIAS").fill("Grace Hopper");
    await dialog(page).getByRole("button", { name: "Save avatar" }).click();

    const unsent = failure(page, "The command was not sent.");
    await expect(unsent).toBeVisible();
    expect(await paintsOnTop(unsent)).toBe(true);
    await expect(dialog(page).getByLabel("DISPLAY ALIAS")).toHaveValue("Grace Hopper");
    await dismissal(unsent).click();
    await expect(unsent).toBeHidden();
    await closeDialog(page);
    await expect(roster(page).getByRole("button", { name: "developer" })).toBeVisible();
    expect(browserErrors.splice(0)).toEqual([expect.stringContaining("set-preference")]);
  });

  test("a pause the director did not choose is announced as a whole sentence, with the way out", async ({ page }) => {
    await stageState(page, (state) => {
      state.paused = { since: new Date().toISOString(), reason: CAP_REASON };
    });
    await openProject(page, "alpha");

    const notice = page.getByRole("status").filter({ hasText: "It paused itself" });
    await expect(notice).toContainText(`The shop is paused: nothing new starts, what is running finishes. It paused itself because ${CAP_REASON}.`);
    await expect(notice.getByRole("button", { name: "Resume the shop" })).toBeVisible();
  });

  test("on a narrow screen each pause control still says which pause it is", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openProject(page, "alpha");

    await expect(pauseControl(page, "Pause this project")).toHaveText(/^\s*project\s*$/i, { useInnerText: true });
    await expect(pauseControl(page, "Pause the shop")).toHaveText(/^\s*shop\s*$/i, { useInnerText: true });
  });

  for (const width of [390, 600]) {
    test(`at ${width}px the header names the project in full, and each pause control still says which pause it is`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      for (const name of ["alpha", "beta"]) {
        await openProject(page, name);
        await expect(studioHeading(page)).toHaveText(`The ${name} studio.`);
        expect(await studioHeading(page).evaluate((heading) => heading.scrollWidth <= heading.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await expect(pauseControl(page, "Pause this project")).toHaveText(/^\s*project\s*$/i, { useInnerText: true });
        await expect(pauseControl(page, "Pause the shop")).toHaveText(/^\s*shop\s*$/i, { useInnerText: true });
      }
    });
  }

  test("keeps a studio's style and an agent's alias in the service, for any browser", async ({ page, browser, baseURL }) => {
    await openProject(page, "beta");
    await expect(projectEntry(page, "beta")).toContainText("acme/beta");

    await page.getByRole("button", { name: "Style the studio" }).click();
    const kyoto = place(page, "Kyoto");
    await kyoto.click();
    await expect(kyoto).toHaveAttribute("aria-pressed", "true");
    await dialog(page).getByRole("button", { name: "Save style" }).click();
    await expect(toast(page, "Style saved for this project.")).toBeVisible();
    await expect(projectEntry(page, "beta")).toContainText("Kyoto · Year-round");

    await roster(page).getByRole("button", { name: "developer" }).click();
    await dialog(page).getByRole("button", { name: "Look", exact: true }).click();
    await dialog(page).getByLabel("DISPLAY ALIAS").fill("Ada Lovelace");
    await dialog(page).getByRole("button", { name: "Save avatar" }).click();
    await expect(toast(page, "Avatar saved for this agent and project.")).toBeVisible();
    await expect(roster(page).getByRole("button", { name: "Ada Lovelace" })).toBeVisible();

    const errors = await visitInFreshBrowser(browser, baseURL, async (other) => {
      await other.goto("/");
      await expect(projectEntry(other, "beta")).toContainText("Kyoto · Year-round");
      await expect(projectEntry(other, "alpha")).not.toContainText("Kyoto");

      await projectEntry(other, "beta").click();
      await expect(other.getByLabel(/^beta studio: Kyoto · Year-round, By zones/)).toBeVisible();
      await expect(studio(other, "beta")).toContainText("Kyoto · Year-round · By zones");
      await expect(roster(other).getByRole("button", { name: "Ada Lovelace" })).toBeVisible();
      await expect(roster(other).getByRole("img", { name: "Ada Lovelace's avatar" })).toBeVisible();

      await other.getByRole("button", { name: "Style the studio" }).click();
      await expect(place(other, "Kyoto")).toHaveAttribute("aria-pressed", "true");
    });
    expect(errors).toEqual([]);
  });

  test("uploads once what a browser had styled before, without replacing what the service already keeps", async ({ browser, baseURL }) => {
    const legacy = {
      [LEGACY_STUDIOS_KEY]: JSON.stringify({
        alpha: { place: "kyoto", season: "autumn", festival: "none", layout: "open", wardrobe: "personal" },
        beta: { place: "coast", season: "summer", festival: "none", layout: "zones", wardrobe: "personal" },
      }),
    };

    const uploading = await visitInFreshBrowser(
      browser,
      baseURL,
      async (old) => {
        await old.goto("/");
        await expect(old.getByLabel(/^alpha studio: Kyoto · Autumn, Open studio/)).toBeVisible();
        await expect.poll(() => old.evaluate((key) => localStorage.getItem(key), LEGACY_STUDIOS_KEY)).toBeNull();
      },
      legacy,
    );
    expect(uploading).toEqual([]);

    const elsewhere = await visitInFreshBrowser(browser, baseURL, async (other) => {
      await other.goto("/");
      await expect(other.getByLabel(/^alpha studio: Kyoto · Autumn, Open studio/)).toBeVisible();
      await expect(studio(other, "alpha")).toContainText("Kyoto · Autumn · Open studio");
      await expect(projectEntry(other, "beta")).toContainText("Kyoto · Year-round");
      await expect(projectEntry(other, "beta")).not.toContainText("Mediterranean coast");

      await projectEntry(other, "beta").click();
      await expect(other.getByLabel(/^beta studio: Kyoto · Year-round, By zones/)).toBeVisible();
    });
    expect(elsewhere).toEqual([]);
  });

  test("a style being saved cannot be sent twice, and its confirmation is spoken by a region that was already there", async ({ page }) => {
    await openProject(page, "beta");
    const region = page.locator("[role=status]:empty");
    await expect(region).toHaveCount(1);
    expect(await region.evaluate((element) => getComputedStyle(element).display)).not.toBe("none");
    await region.evaluate((element) => element.setAttribute("data-there-before", ""));

    let answer = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    await page.route("**/api/commands/set-preference", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("button", { name: "Style the studio" }).click();
    await dialog(page).getByRole("button", { name: "Save style" }).click();
    await expect(dialog(page).getByRole("button", { name: "Save style" })).toBeDisabled();

    answer();
    const confirmation = page.locator("[data-there-before]");
    await expect(confirmation).toHaveText("Style saved for this project.");
    await expect(confirmation).toBeVisible();
    expect(await confirmation.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
  });

  test("a look saved by a slow office does not close the dialog the director opened meanwhile", async ({ page }) => {
    await openProject(page, "beta");
    let answer = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    await page.route("**/api/commands/set-preference", async (route) => {
      await held;
      await route.continue();
    });
    await roster(page).getByRole("button", { name: "manager" }).click();
    await dialog(page).getByRole("button", { name: "Look", exact: true }).click();
    await dialog(page).getByRole("button", { name: "Save avatar" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();

    await roster(page).getByRole("button").nth(1).click();
    await expect(dialog(page).getByText("BETA · DEVELOPER")).toBeVisible();
    answer();

    await expect(toast(page, "Avatar saved for this agent and project.")).toBeVisible();
    await expect(dialog(page).getByText("BETA · DEVELOPER")).toBeVisible();
  });
});
