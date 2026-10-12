import { defineConfig } from "@playwright/test";
import { LOCAL_OFFICE, PAIRING_SECRET, SESSION_OFFICE } from "./offices";

const portOf = (office: string) => new URL(office).port;

// One simulated shop serves every spec, so they run one after another and each keeps to its own project.
// A second one asks for a session, for the specs about a studio connecting to an office elsewhere.
export default defineConfig({
  testDir: ".",
  outputDir: "../../../test-results",
  workers: 1,
  // CI renders the office in software on two cores: the same steps take three to four times as long there.
  timeout: process.env.CI ? 120_000 : 30_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  // The specs are about what the shop does, not how the office moves: a still office leaves the browser its time.
  use: { reducedMotion: "reduce", baseURL: LOCAL_OFFICE, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    {
      command: `PORT=${portOf(LOCAL_OFFICE)} npx tsx packages/studio/e2e/serve.ts`,
      cwd: "../../..",
      url: `${LOCAL_OFFICE}/api/state`,
      reuseExistingServer: false,
    },
    {
      command: `PORT=${portOf(SESSION_OFFICE)} SKYNOT_OFFICE_URL=${SESSION_OFFICE} SKYNOT_STUDIO=${LOCAL_OFFICE}/ SKYNOT_E2E_PAIRING_SECRET=${PAIRING_SECRET} npx tsx packages/studio/e2e/serve.ts`,
      cwd: "../../..",
      url: `${SESSION_OFFICE}/api/meta`,
      reuseExistingServer: false,
    },
  ],
});
