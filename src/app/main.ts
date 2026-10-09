import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { FakeVcs, FakeWorkspace } from "../delivery";
import type { EngineName } from "../execution";
import { loadPolicy, parsePolicy, type Policy } from "../governance";
import { createApi } from "./http/api";
import { createMockDeveloper, createMockManager } from "./mock-engines";
import { createShop } from "./shop";

const mock = process.env.SKYNOT_MOCK === "1";
const port = Number(process.env.PORT ?? 4747);
const policyPath = process.env.SKYNOT_POLICY ?? "policy.yaml";
const dataDir = process.env.SKYNOT_DATA ?? (mock ? "data/mock" : "data/shop");
const consoleDir = "console/dist";

async function readPolicy(): Promise<Policy> {
  if (existsSync(policyPath)) {
    const loaded = await loadPolicy(policyPath);
    if (!loaded.ok) throw new Error(loaded.error);
    return loaded.value;
  }
  if (!mock) throw new Error(`${policyPath} not found. Copy policy.example.yaml to policy.yaml and set your repository.`);

  const example = (await readFile("policy.example.yaml", "utf8")).replace("OWNER/REPO", "demo/todo");
  const parsed = parsePolicy(example);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function engineFrom(name: string): EngineName {
  if (name === "claude" || name === "codex") return name;
  throw new Error(`unknown engine "${name}": use claude or codex`);
}

const policy = await readPolicy();
const vcs = new FakeVcs();

const shop = await createShop({
  policy,
  dataDir,
  managerEngine: mock ? "claude" : engineFrom(process.env.SKYNOT_MANAGER_ENGINE ?? "claude"),
  workerEngine: mock ? "codex" : engineFrom(process.env.SKYNOT_WORKER_ENGINE ?? "claude"),
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

shop.watcher.start(mock ? 2_000 : 30_000);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`skynot console on http://127.0.0.1:${port}${mock ? "  (simulated engines, nothing leaves this machine)" : ""}`);
  if (!existsSync(consoleDir)) console.log("The console is not built yet: run `npm run build:console`.");
});

process.on("SIGINT", () => {
  shop.stop();
  process.exit(0);
});
