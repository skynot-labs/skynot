import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SESSION_DAYS = 30;
const MAX_FAILED_PAIRINGS = 5;
const FAILED_PAIRING_WINDOW_MS = 60_000;

// An office that answers at an address beyond this machine: every request then carries a session.
export interface OfficeAccess {
  // The origin the office is reached as, such as https://office.example.ts.net.
  readonly address: string;
  // The origins of the studios allowed to call it from a browser.
  readonly studios: readonly string[];
  readonly secret: string;
  readonly key: Buffer;
  readonly now?: () => number;
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const sign = (key: Buffer, body: string): string => createHmac("sha256", key).update(body).digest("base64url");

function same(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

// A signed token rather than a stored one: it survives a restart with nothing to keep, and deleting the key ends them all.
export function issueSession(access: OfficeAccess): { token: string; expiresAt: string } {
  const expires = (access.now?.() ?? Date.now()) + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const body = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "director", exp: Math.floor(expires / 1000) })}`;
  return { token: `${body}.${sign(access.key, body)}`, expiresAt: new Date(expires).toISOString() };
}

export function sessionIsValid(access: OfficeAccess, token: string): boolean {
  const [header, payload, signature, ...rest] = token.split(".");
  if (!header || !payload || !signature || rest.length > 0) return false;
  if (!same(signature, sign(access.key, `${header}.${payload}`))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: unknown };
    return typeof exp === "number" && exp * 1000 > (access.now?.() ?? Date.now());
  } catch {
    return false;
  }
}

// Whoever holds the pairing secret gets a session, so guessing it is slowed down for everyone at once.
export function pairingDesk(access: OfficeAccess) {
  let failures: number[] = [];
  return (secret: string): "paired" | "refused" | "locked" => {
    const now = access.now?.() ?? Date.now();
    failures = failures.filter((at) => now - at < FAILED_PAIRING_WINDOW_MS);
    if (failures.length >= MAX_FAILED_PAIRINGS) return "locked";
    if (same(secret, access.secret)) return "paired";
    failures.push(now);
    return "refused";
  };
}

async function keptSecret(file: string): Promise<string> {
  const kept = await readFile(file, "utf8").catch(() => null);
  if (kept?.trim()) return kept.trim();
  const fresh = randomBytes(32).toString("base64url");
  await writeFile(file, `${fresh}\n`, { mode: 0o600 });
  return fresh;
}

function originOf(value: string, name: string, localOnlyOverHttp: boolean): string {
  if (!URL.canParse(value)) throw new Error(`${name} must be an address such as https://office.example.ts.net, not "${value}"`);
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(localOnlyOverHttp && local && url.protocol === "http:")) {
    throw new Error(`${name} must use https: a session sent over http can be read by anyone on the way`);
  }
  return url.origin;
}

export const PUBLIC_STUDIO = "https://skynot-labs.github.io/skynot/studio/";

// Without SKYNOT_OFFICE_URL the office stays where it was: this machine only, no session.
export async function readOfficeAccess(env: NodeJS.ProcessEnv, dataDir: string): Promise<(OfficeAccess & { studio: string }) | undefined> {
  if (!env.SKYNOT_OFFICE_URL) return undefined;
  const studio = env.SKYNOT_STUDIO ?? PUBLIC_STUDIO;
  await mkdir(dataDir, { recursive: true });
  return {
    address: originOf(env.SKYNOT_OFFICE_URL, "SKYNOT_OFFICE_URL", true),
    studios: [originOf(studio, "SKYNOT_STUDIO", true)],
    studio,
    secret: await keptSecret(join(dataDir, "pairing.secret")),
    key: Buffer.from(await keptSecret(join(dataDir, "session.key")), "base64url"),
  };
}

export function pairingLink(studio: string, access: Pick<OfficeAccess, "address" | "secret">): string {
  return `${studio}#office=${encodeURIComponent(access.address)}&secret=${access.secret}`;
}
