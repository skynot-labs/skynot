import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

export const APP_ID = "SKYNOT_GITHUB_APP_ID";
export const APP_KEY = "SKYNOT_GITHUB_APP_KEY";

export interface Home {
  readonly home: string;
  readonly xdgConfigHome?: string | undefined;
}

// The XDG specification says a relative XDG_CONFIG_HOME is to be ignored.
export const keyPath = ({ home, xdgConfigHome }: Home): string =>
  path.join(xdgConfigHome && path.isAbsolute(xdgConfigHome) ? xdgConfigHome : path.join(home, ".config"), "skynot", "app.pem");

const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

export type AppState =
  | { readonly kind: "registered"; readonly appId: string; readonly keyPath: string }
  | { readonly kind: "absent" }
  | { readonly kind: "inconsistent"; readonly problem: string };

// What a previous run, or the director by hand, already left: decided before anything is asked of GitHub.
export async function appState(envFile: string, key: string): Promise<AppState> {
  const env = parseEnv(await readFile(envFile, "utf8").catch(() => ""));
  const appId = env[APP_ID];
  const named = env[APP_KEY];
  if (appId && named) {
    if (await exists(named)) return { kind: "registered", appId, keyPath: named };
    return { kind: "inconsistent", problem: `${envFile} names the GitHub App ${appId}, but its key ${named} is not there. Put the key back, or remove the ${APP_ID} and ${APP_KEY} lines to register a new App.` };
  }
  if (appId || named) return { kind: "inconsistent", problem: `${envFile} sets only one of ${APP_ID} and ${APP_KEY}. Set both, or remove the line to register a new App.` };
  if (await exists(key)) return { kind: "inconsistent", problem: `A key already exists at ${key} and ${envFile} names no App. The setup never overwrites a key: move it away, or set ${APP_ID} and ${APP_KEY} by hand.` };
  return { kind: "absent" };
}

export async function prepareKeyFolder(file: string): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

// "wx" fails on an existing file: a key is never overwritten.
export const saveKey = (file: string, pem: string): Promise<void> => writeFile(file, pem, { mode: 0o600, flag: "wx" });

const assigns = (name: string) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
const quoted = (value: string): string => (/^[\w./:@+-]+$/.test(value) ? value : `"${value}"`);

export function withAppLines(env: string, appId: string, key: string): string {
  const wanted = new Map([
    [APP_ID, appId],
    [APP_KEY, quoted(key)],
  ]);
  const lines = env === "" ? [] : env.replace(/\n$/, "").split("\n");
  const updated = lines.map((line) => {
    const name = [...wanted.keys()].find((candidate) => assigns(candidate).test(line));
    if (!name) return line;
    const value = wanted.get(name)!;
    wanted.delete(name);
    return `${name}=${value}`;
  });
  return [...updated, ...[...wanted].map(([name, value]) => `${name}=${value}`)].join("\n") + "\n";
}

export async function nameAppInEnv(envFile: string, appId: string, key: string): Promise<void> {
  const current = await readFile(envFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  await writeFile(envFile, withAppLines(current, appId, key));
}
