import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { FakeVcs, FakeWorkspace } from "../delivery";
import { readPolicy, readTeam } from "./config";
import { lockDataDir } from "./data-lock";
import { briefingStore, PROJECTS_DIR, projectsFolder, readProjects } from "./projects";
import { pairingLink, readOfficeAccess } from "./http/access";
import { createApi } from "./http/api";
import { createMockDeveloper, createMockManager } from "./mock-engines";
import { ClaudeEngine, CodexEngine } from "../execution";
import { YamlProjectRegistry } from "../projects";
import { checkShopReadiness } from "./readiness";
import { githubExec } from "./github";
import { createShop } from "./shop";

const mock = process.env.SKYNOT_MOCK === "1";
const port = Number(process.env.PORT ?? 4747);
const dataDir = process.env.SKYNOT_DATA ?? (mock ? "data/mock" : "data/shop");
const consoleDir = "console/dist";

const policy = await readPolicy(mock);
const vcs = new FakeVcs();

const projects = await readProjects(policy, mock);
const teams = Object.fromEntries(await Promise.all(projects.map(async (project) => [project.id, await readTeam(mock, project.id)] as const)));
const team = teams[projects[0]!.id]!;
process.on("exit", await lockDataDir(dataDir));
const github = mock ? undefined : await githubExec();
const shop = await createShop({
  policy,
  dataDir,
  team,
  projects,
  briefing: briefingStore(policy),
  teams,
  ...(github && {
    exec: github.exec,
    execFor: github.execFor,
    readiness: () => checkShopReadiness({ exec: github.exec, execFor: github.execFor, engines: { claude: new ClaudeEngine(), codex: new CodexEngine() }, teams: projects.map((project) => ({ project, team: teams[project.id]! })), dataDir }),
  }),
  reportError: (error, event) => console.error(`handler failed on ${event.type}:`, error),
  ...(mock && {
    engines: { claude: createMockManager(), codex: createMockDeveloper() },
    vcs,
    workspace: new FakeWorkspace(),
  }),
});

const access = await readOfficeAccess(process.env, dataDir);
const api = createApi(shop, {
  allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
  ...(access && { access }),
  onError: (error) => console.error("command failed:", error),
  projects: { registry: new YamlProjectRegistry(PROJECTS_DIR), folder: () => projectsFolder(), policyRepos: policy.repos.map((repo) => repo.name) },
  ...(mock && {
    devTools: {
      async mergePullRequest(orderId: string) {
        const order = shop.orders.get(orderId);
        if (order?.status !== "in_review" || order.pullRequest === null) return false;
        vcs.setPullRequestState(shop.repo, order.pullRequest, "merged");
        await shop.watcher.poll();
        return true;
      },
    },
  }),
});

const app = new Hono();
app.route("/", api);
if (existsSync(consoleDir)) {
  // A page in a folder loads its files relative to itself, so without the trailing slash it would get the console's instead.
  app.get("/*", (context, next) => {
    const { path } = context.req;
    const isFolderPage = /^(\/[a-z0-9-]+)+$/.test(path) && existsSync(`${consoleDir}${path}/index.html`);
    return isFolderPage ? Promise.resolve(context.redirect(`${path}/`, 308)) : next();
  });
  app.use("/*", serveStatic({ root: consoleDir }));
  app.get("*", serveStatic({ path: `${consoleDir}/index.html` }));
}

void shop.readiness.refresh().then(() => {
  for (const finding of shop.readiness.findings().filter((entry) => entry.level !== "ok")) {
    console.warn(`[${finding.level}] ${finding.check}: ${finding.detail}. ${finding.fix ?? ""}`);
  }
});
shop.watcher.start(mock ? 2_000 : 30_000);
shop.intake.start(mock ? 5_000 : 60_000);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  if (github) console.log(`GitHub: acting as ${github.identity}`);
  console.log(`skynot console on http://127.0.0.1:${port}${mock ? "  (simulated engines, nothing leaves this machine)" : ""}`);
  if (!existsSync(consoleDir)) console.log("The console is not built yet: run `npm run build:console`.");
  if (access) {
    console.log(`\nThe office answers at ${access.address} and asks every request for a session.`);
    console.log(`Pair a studio by opening this link. Whoever has it can run the shop, so treat it as a password:\n  ${pairingLink(access.studio, access)}`);
    if (!access.studio.startsWith(access.address)) console.log(`The console this office serves pairs with:\n  ${pairingLink(`${access.address}/`, access)}`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shop.stop();
    process.exit(0);
  });
}
