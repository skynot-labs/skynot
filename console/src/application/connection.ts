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

export async function pair(office: string, secret: string): Promise<Connection> {
  let response: Response;
  try {
    response = await fetch(`${office}/api/sessions`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
  } catch {
    throw new Error(`Could not reach the office at ${office}. Check the address, that the office is running, and that it expects this studio.`);
  }
  const answer: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(textIn(answer, "error") ?? `The office refused to pair (${response.status}).`);
  const token = textIn(answer, "token");
  if (!token) throw new Error("The office answered, but not with a session.");
  return { office, token };
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
