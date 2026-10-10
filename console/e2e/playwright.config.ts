import { defineConfig } from "@playwright/test";

const port = Number(process.env.SKYNOT_E2E_PORT ?? 4799);

// One simulated shop serves every spec, so they run one after another and each keeps to its own project.
export default defineConfig({
  testDir: ".",
  outputDir: "../../test-results",
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `PORT=${port} npx tsx console/e2e/serve.ts`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}/api/state`,
    reuseExistingServer: false,
  },
});
