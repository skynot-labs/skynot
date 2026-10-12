import { randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { appManifest, manifestTarget } from "./manifest";

export interface RegisteredApp {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly htmlUrl: string;
  readonly pem: string;
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RegisterAppInput {
  readonly name: string;
  readonly organization: string | null;
  readonly fetch: Fetch;
  // Told where the page that sends the manifest is, once the server answers there.
  readonly announce: (url: string) => void | Promise<void>;
  readonly timeoutMs: number;
  readonly state?: string;
}

// GitHub creates the App when the director confirms on its page, before the code is exchanged: a code that reached us means an App exists.
export class AppCreatedButNotFetched extends Error {}

export async function registerApp(input: RegisterAppInput): Promise<RegisteredApp> {
  const state = input.state ?? randomBytes(16).toString("hex");
  let settle: (outcome: RegisteredApp | Error) => void = () => undefined;
  const outcome = new Promise<RegisteredApp | Error>((resolve) => (settle = resolve));

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET") return void page(response, 405, "Only GET is answered here.");
    if (url.pathname === "/") return void page(response, 200, manifestForm(input, state, redirectUrl(server.address() as AddressInfo)), true);
    if (url.pathname !== "/callback") return void page(response, 404, "Nothing here.");

    const code = url.searchParams.get("code");
    if (url.searchParams.get("state") !== state || !code) return void page(response, 400, "This is not the answer the setup command is waiting for. Start again from the address it printed.");
    convert(input.fetch, code).then(
      (app) => {
        page(response, 200, `The App ${escapeHtml(app.name)} was created. Go back to the terminal.`);
        settle(app);
      },
      (error: Error) => {
        page(response, 502, "GitHub created the App, but its key could not be fetched. The terminal says what to do.");
        settle(error);
      },
    );
  });

  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const timer = setTimeout(
    () => settle(new Error("GitHub did not come back in time, so nothing was fetched. If you did confirm on GitHub, the App exists there without its key here: delete it before running the setup again.")),
    input.timeoutMs,
  );
  try {
    await input.announce(`http://127.0.0.1:${port}/`);
    const result = await outcome;
    if (result instanceof Error) throw result;
    return result;
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}

const redirectUrl = ({ port }: AddressInfo): string => `http://127.0.0.1:${port}/callback`;

async function convert(fetch: Fetch, code: string): Promise<RegisteredApp> {
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "skynot-setup" },
  }).catch((error: Error) => {
    throw new AppCreatedButNotFetched(`GitHub could not be reached to fetch the App's key: ${error.message}`);
  });
  if (!response.ok) throw new AppCreatedButNotFetched(`GitHub answered ${response.status} when asked for the App's key`);

  // Only the fields are read, and the body is never put in a message: it holds the private key.
  const body = (await response.json().catch(() => null)) as { id?: unknown; slug?: unknown; name?: unknown; html_url?: unknown; pem?: unknown } | null;
  const { id, slug, name, html_url: htmlUrl, pem } = body ?? {};
  if (typeof id !== "number" || typeof slug !== "string" || typeof htmlUrl !== "string" || typeof pem !== "string" || !pem) {
    throw new AppCreatedButNotFetched("GitHub's answer did not carry the App's id, address and key");
  }
  return { id, slug, name: typeof name === "string" ? name : slug, htmlUrl, pem };
}

function manifestForm(input: RegisterAppInput, state: string, redirect: string): string {
  const manifest = JSON.stringify(appManifest(input.name, redirect));
  return `<form id="manifest" method="post" action="${escapeHtml(manifestTarget(input.organization, state))}">
<input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
<p>This sends GitHub the description of the App ${escapeHtml(input.name)}. GitHub asks you to confirm before it creates anything.</p>
<button type="submit">Continue to GitHub</button>
</form>
<script>document.getElementById("manifest").submit()</script>`;
}

function page(response: ServerResponse, status: number, body: string, html = false): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(`<!doctype html><meta charset="utf-8"><title>skynot setup</title>${html ? body : `<p>${body}</p>`}`);
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
