import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = await mkdtemp(join(tmpdir(), "skynot-e2e-"));
await cp(fileURLToPath(new URL("./fixtures/projects", import.meta.url)), join(root, "projects"), { recursive: true });

delete process.env.SKYNOT_GITHUB_APP_ID;
delete process.env.SKYNOT_GITHUB_APP_KEY;
Object.assign(process.env, { SKYNOT_MOCK: "1", SKYNOT_DATA: join(root, "data"), SKYNOT_PROJECTS: join(root, "projects") });

await import("../../src/app/main");
