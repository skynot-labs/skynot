import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { FakeVcs, FakeWorkspace } from "../delivery";
import { readPolicy, readTeam } from "./config";
import { createApi } from "./http/api";
import { createMockDeveloper, createMockManager } from "./mock-engines";
import { ClaudeEngine, CodexEngine } from "../execution";
import { exec } from "../kernel/process";
import { checkReadiness, engineUsage } from "./readiness";
import { createShop } from "./shop";

const mock = process.env.SKYNOT_MOCK === "1";
const port = Number(process.env.PORT ?? 4747);
const dataDir = process.env.SKYNOT_DATA ?? (mock ? "data/mock" : "data/shop");
const consoleDir = "console/dist";

const policy = await readPolicy(mock);
const vcs = new FakeVcs();

const team = await readTeam(mock);
const shop = await createShop({
  policy,
  dataDir,
  team,
  ...(!mock && {
    readiness: () => checkReadiness({ exec, engines: { claude: new ClaudeEngine(), codex: new CodexEngine() }, usage: engineUsage(team), repo: policy.repos[0]!.name, baseBranch: policy.repos[0]!.base_branch, dataDir }),
  }),
  reportError: (error, event) => console.error(`handler failed on ${event.type}:`, error),
  ...(mock && {
    engines: { claude: createMockManager(), codex: createMockDeveloper() },
    vcs,
    workspace: new FakeWorkspace(),
  }),
});

const api = createApi(shop, {
  allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
  onError: (error) => console.error("command failed:", error),
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
  app.use("/*", serveStatic({ root: consoleDir }));
  app.get("*", serveStatic({ path: `${consoleDir}/index.html` }));
}

void shop.readiness.refresh().then(() => {
  for (const finding of shop.readiness.findings().filter((entry) => entry.level !== "ok")) {
    console.warn(`[${finding.level}] ${finding.check}: ${finding.detail}. ${finding.fix ?? ""}`);
  }
});
shop.watcher.start(mock ? 2_000 : 30_000);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`skynot console on http://127.0.0.1:${port}${mock ? "  (simulated engines, nothing leaves this machine)" : ""}`);
  if (!existsSync(consoleDir)) console.log("The console is not built yet: run `npm run build:console`.");
});

process.on("SIGINT", () => {
  shop.stop();
  process.exit(0);
});
