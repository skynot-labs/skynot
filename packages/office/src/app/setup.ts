import "./env-file";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { policyPath, teamPath } from "./config";
import { PROJECTS_DIR } from "./projects";
import { setup } from "./setup/setup";
import { checkShop, findingLines } from "./shop-check";

const terminal = createInterface({ input: process.stdin });
// Read as a queue, so an answer typed or piped before its question is not lost.
const answers = terminal[Symbol.asyncIterator]();

async function ask(question: string): Promise<string> {
  process.stdout.write(question);
  const { value, done } = await answers.next();
  if (done) throw new Error("The terminal was closed before the setup finished.");
  return value;
}

// Fails quietly where there is no browser to open: the address is printed either way.
function openInBrowser(url: string): void {
  const [command, ...args] = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  spawn(command!, args, { stdio: "ignore", detached: true })
    .on("error", () => undefined)
    .unref();
}

async function check(app: Record<string, string>): Promise<void> {
  console.log("\nChecking the shop:");
  try {
    const { identity, findings } = await checkShop({ ...app, ...process.env });
    console.log(`GitHub: acting as ${identity}`);
    for (const line of findingLines(findings)) console.log(line);
    console.log(
      findings.some((finding) => finding.level === "fail")
        ? "\nFix what says FAIL and run `npm run check` until it does not. Then: npm run build:console && npm run start"
        : "\nThe shop is ready: npm run build:console && npm run start",
    );
  } catch (error) {
    console.log(`The check could not run: ${(error as Error).message}\nFix that and run \`npm run check\`.`);
  }
}

try {
  await setup({
    paths: { root: process.cwd(), policy: policyPath, team: teamPath, projects: PROJECTS_DIR },
    home: { home: homedir(), xdgConfigHome: process.env.XDG_CONFIG_HOME },
    ask,
    say: (line) => console.log(line),
    open: openInBrowser,
    fetch: (url, init) => fetch(url, init),
    timeoutMs: 10 * 60_000,
    check,
  });
} catch (error) {
  console.error(`\n${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  terminal.close();
}
