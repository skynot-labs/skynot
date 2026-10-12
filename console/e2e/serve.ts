import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = await mkdtemp(join(tmpdir(), "skynot-e2e-"));
await cp(fileURLToPath(new URL("./fixtures/projects", import.meta.url)), join(root, "projects"), { recursive: true });

delete process.env.SKYNOT_GITHUB_APP_ID;
delete process.env.SKYNOT_GITHUB_APP_KEY;
Object.assign(process.env, { SKYNOT_MOCK: "1", SKYNOT_DATA: join(root, "data"), SKYNOT_PROJECTS: join(root, "projects") });

// An office keeps the pairing secret it finds, so the specs can know the one a session-asking office will take.
if (process.env.SKYNOT_E2E_PAIRING_SECRET) {
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data", "pairing.secret"), `${process.env.SKYNOT_E2E_PAIRING_SECRET}\n`);
}

const office = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../../src/app/main.ts", import.meta.url))], { stdio: "inherit" });
office.on("exit", (code) => process.exit(code ?? 1));
