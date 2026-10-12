import { RefusalSchema, SessionSchema } from "@skynot/contract";

export interface Connection {
  // The office's origin, with no trailing slash.
  office: string;
  token: string;
}

export interface Pairing {
  office: string;
  secret: string;
}

const KEY = "skynot.connection";
const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

// A session sent over plain http can be read on the way, so only an office on this machine may use it.
export function officeOrigin(address: string): string | null {
  const typed = address.trim();
  const candidate = typed.includes("://") ? typed : `https://${typed}`;
  if (!typed || !URL.canParse(candidate)) return null;
  const url = new URL(candidate);
  const allowed = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname));
  return allowed ? url.origin : null;
}

export function pairingFrom(hash: string): Pairing | null {
  const fields = new URLSearchParams(hash.replace(/^#/, ""));
  const office = officeOrigin(fields.get("office") ?? "");
  const secret = fields.get("secret");
  return office && secret ? { office, secret } : null;
}

// Long enough for a relayed tailnet to answer and for a permission prompt to be read; a browser left alone waits far longer.
export const OFFICE_PATIENCE_MS = 15_000;

export function addressProblem(address: string, studioProtocol: string): string | null {
  const origin = officeOrigin(address);
  if (studioProtocol !== "https:") return origin ? null : "Use the office's https address. Plain http only works for an office on this machine.";
  if (!origin) return "Use the office's https address, such as https://office.example.ts.net.";
  if (!origin.startsWith("http:")) return null;
  return `This studio is served over https, and from here a browser cannot reach an office on this machine at ${origin}. Open the console the office serves itself at ${origin}, or give the office an https address (with Tailscale, \`npm run start:shared\`) and use that one.`;
}

export async function pair(office: string, secret: string): Promise<Connection> {
  const patience = new AbortController();
  const givingUp = setTimeout(() => patience.abort(), OFFICE_PATIENCE_MS);
  let response: Response;
  try {
    response = await fetch(`${office}/api/sessions`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
      signal: patience.signal,
    });
  } catch {
    throw new Error(unreachable(office));
  } finally {
    clearTimeout(givingUp);
  }
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(refusal(response.status, RefusalSchema.safeParse(answer).data?.error ?? "", office));
  const session = SessionSchema.safeParse(answer);
  if (!session.success) {
    throw new Error(`${office} answered, but not with a session. Check that it is your office's address. If it is, this studio and the office are different versions: update whichever is older.`);
  }
  return { office, token: session.data.token };
}

// A browser reports every one of these as the same failed request.
function unreachable(office: string): string {
  return [
    `Could not reach the office at ${office}. Check, in this order:`,
    "1. The address is the one in the pairing link the office printed when it started.",
    "2. The office is running.",
    "3. The office accepts this studio. It takes calls from the public studio only, unless it was started with this studio's address in SKYNOT_STUDIO.",
    "4. The browser may reach your local network. If it asked and was refused, allow local network access for this site in the site's settings and reload.",
  ].join("\n");
}

function refusal(status: number, reason: string, office: string): string {
  if (status === 401) return "That is not this office's pairing secret. Copy it from the pairing link the office printed when it started, or from the file pairing.secret in the office's data folder.";
  if (status === 403 && reason === "unknown host") {
    return `The office was reached at ${office}, an address it was not started with. Start it with SKYNOT_OFFICE_URL set to exactly that address, scheme included.`;
  }
  if (status === 404 && reason) {
    return "This office takes no sessions: it answers on its own machine only. Open the console it serves there, or start it with its address in SKYNOT_OFFICE_URL to pair a studio with it.";
  }
  if (reason) return reason;
  return `${office} refused to pair (${status}), and not in an office's words. Check that it is your office's address and that the office is running.`;
}

export function rememberedConnection(): Connection | null {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const office = officeOrigin(textIn(kept, "office") ?? "");
    const token = textIn(kept, "token");
    return office && token ? { office, token } : null;
  } catch {
    return null;
  }
}

export function rememberConnection(connection: Connection): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(connection));
  } catch {
    // the connection only lasts until the page reloads
  }
}

export function forgetConnection(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing was kept
  }
}

function textIn(value: unknown, field: string): string | null {
  const found = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[field] : null;
  return typeof found === "string" && found ? found : null;
}
