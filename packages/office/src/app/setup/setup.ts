import { rm } from "node:fs/promises";
import path from "node:path";
import { APP_ID, APP_KEY, appState, keyPath, nameAppInEnv, prepareKeyFolder, saveKey, type Home } from "./credentials";
import { APP_PERMISSIONS, appName, appsSettingsUrl, deleteAppUrl, isOrganizationName } from "./manifest";
import { AppCreatedButNotFetched, registerApp, type Fetch, type RegisteredApp } from "./register-app";
import { copyExamples, needsProject, parseRepository, type Repository, type ShopPaths } from "./shop-files";

export interface SetupInput {
  readonly paths: ShopPaths;
  readonly home: Home;
  readonly ask: (question: string) => Promise<string>;
  readonly say: (line: string) => void;
  readonly open: (url: string) => void | Promise<void>;
  readonly fetch: Fetch;
  readonly timeoutMs: number;
  // Runs the readiness check and prints it; given the App a first run just wrote to .env, which this process has not read.
  readonly check: (app: Record<string, string>) => Promise<void>;
}

export async function setup(input: SetupInput): Promise<void> {
  const { paths, ask, say } = input;
  const envFile = path.join(paths.root, ".env");
  const key = keyPath(input.home);

  const state = await appState(envFile, key);
  if (state.kind === "inconsistent") throw new Error(state.problem);

  const repository = (await needsProject(paths)) ? await askRepository(input) : null;

  let created: RegisteredApp | null = null;
  if (state.kind === "registered") {
    say(`GitHub App ${state.appId} is already named in .env, with its key at ${state.keyPath}: nothing to create on GitHub.`);
  } else {
    const organization = await askOrganization(input);
    const name = appName(organization ?? repository?.owner ?? null);
    say("");
    say("This will create a GitHub App:");
    say(`  name         ${name} (GitHub lets you change it on its page)`);
    say(`  account      ${organization ? `the organization ${organization}` : "your personal account, the one your browser is signed in to"}`);
    say(`  permissions  ${Object.entries(APP_PERMISSIONS).map(([permission, level]) => `${permission.replace("_", " ")}: ${level}`).join(", ")}`);
    say("  webhook      none");
    say("  visibility   private: it can be installed only on that account");
    say(`Its private key goes to ${key}, and its id and that path to .env. Nothing is created until you confirm on GitHub's page.`);
    await ask("Press Enter to continue, or Ctrl+C to stop. ");

    await prepareKeyFolder(key);
    created = await createApp(input, name, organization);
    await keepApp(created, organization, envFile, key);
    say(`Created the GitHub App ${created.name} (${created.htmlUrl}). Its key is in ${key}.`);
  }

  const files = await copyExamples(paths, repository);
  for (const file of files.created) say(`Wrote ${file}`);
  for (const file of files.kept) say(`${file} already exists: left as it is.`);

  say("");
  if (created) {
    say(`One click is left, and only you can make it: install the App on ${repository?.name ?? "the repository of each project"}.`);
    say(`  ${created.htmlUrl}/installations/new`);
    await ask("Press Enter once it is installed. ");
  } else {
    say("If the App is not installed on each project's repository yet, install it from its page on GitHub; the check below says whether it reaches them.");
  }
  await input.check(created ? { [APP_ID]: String(created.id), [APP_KEY]: key } : {});
}

async function askRepository({ ask, say }: SetupInput): Promise<Repository> {
  for (;;) {
    const parsed = parseRepository(await ask("Which repository will the shop work on (owner/name)? "));
    if (typeof parsed !== "string") return parsed;
    say(parsed);
  }
}

async function askOrganization({ ask, say }: SetupInput): Promise<string | null> {
  for (;;) {
    const answer = (await ask("Who will own the GitHub App? Press Enter for your personal account, or write an organization's name: ")).trim();
    if (answer === "") return null;
    if (isOrganizationName(answer)) return answer;
    say(`"${answer}" is not an organization's name.`);
  }
}

async function createApp(input: SetupInput, name: string, organization: string | null): Promise<RegisteredApp> {
  try {
    return await registerApp({
      name,
      organization,
      fetch: input.fetch,
      timeoutMs: input.timeoutMs,
      announce: async (url) => {
        input.say(`Open this address in a browser signed in to GitHub (trying to open it for you):\n  ${url}`);
        await input.open(url);
      },
    });
  } catch (error) {
    if (!(error instanceof AppCreatedButNotFetched)) throw error;
    throw new Error(
      `GitHub created an App (called ${name}, unless you renamed it on the page), but the setup could not fetch its key: ${error.message}.\n` +
        `It is of no use without that key. To delete it, open ${appsSettingsUrl(organization)}, choose the App, then Advanced, then "Delete GitHub App". Then run the setup again.`,
    );
  }
}

async function keepApp(app: RegisteredApp, organization: string | null, envFile: string, key: string): Promise<void> {
  let keySaved = false;
  try {
    await saveKey(key, app.pem);
    keySaved = true;
    await nameAppInEnv(envFile, String(app.id), key);
  } catch (error) {
    // Only a key this run wrote is removed, so the next run starts clean.
    if (keySaved) await rm(key, { force: true });
    throw new Error(
      `The GitHub App ${app.name} now exists on GitHub (${app.htmlUrl}), but the setup could not keep its key here: ${(error as Error).message}.\n` +
        `Nothing was written on this machine. To delete the App, open ${deleteAppUrl(organization, app.slug)} and choose "Delete GitHub App"; then fix the cause and run the setup again.\n` +
        `To keep it instead, generate a new private key on that App's settings page and set ${APP_ID} and ${APP_KEY} by hand (docs/github-app.md).`,
    );
  }
}
