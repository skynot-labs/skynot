import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueSession, pairingLink, readOfficeAccess, type OfficeAccess } from "../../src/app/http/access";
import { createApi } from "../../src/app/http/api";
import { CONTRACT } from "@skynot/contract";
import { createMockDeveloper, createMockManager } from "../../src/app/mock-engines";
import { createShop, type Shop } from "../../src/app/shop";
import { FakeVcs, FakeWorkspace } from "../../src/delivery";
import { examplePolicy } from "../governance/fixtures";

const LOCAL = "127.0.0.1:4747";
const OFFICE = "https://office.example.ts.net";
const STUDIO = "https://studio.example";
const SECRET = "the-pairing-secret";

let dataDir: string;
let shop: Shop;
let now: number;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "skynot-access-"));
  now = Date.parse("2026-10-12T09:00:00.000Z");
  shop = await createShop({
    policy: examplePolicy(),
    dataDir,
    team: { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} },
    engines: { claude: createMockManager(), codex: createMockDeveloper() },
    vcs: new FakeVcs(),
    workspace: new FakeWorkspace(),
  });
});

afterEach(async () => {
  await shop.manager.idle();
  await shop.flow.idle();
  shop.stop();
  await rm(dataDir, { recursive: true, force: true });
});

const access = (overrides: Partial<OfficeAccess> = {}): OfficeAccess => ({ address: OFFICE, studios: [STUDIO], secret: SECRET, key: Buffer.from("a-signing-key-of-the-office"), now: () => now, ...overrides });
const open = (overrides: Partial<OfficeAccess> = {}): Hono => createApi(shop, { allowedHosts: [LOCAL], access: access(overrides) });

interface Call {
  host?: string;
  origin?: string;
  session?: string;
  body?: unknown;
  method?: string;
}
function call(api: Hono, route: string, { host = "office.example.ts.net", origin, session, body, method }: Call = {}) {
  return api.request(route, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { host, ...(origin && { origin }), ...(session && { authorization: `Bearer ${session}` }), ...(body !== undefined && { "content-type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
async function paired(api: Hono): Promise<string> {
  const response = await call(api, "/api/sessions", { body: { secret: SECRET } });
  return ((await response.json()) as { token: string }).token;
}

describe("an office on this machine only", () => {
  it("asks for no session, says so, and has no sessions to give", async () => {
    const api = createApi(shop, { allowedHosts: [LOCAL] });

    expect(await (await call(api, "/api/meta", { host: LOCAL })).json()).toEqual({ contract: CONTRACT, requiresSession: false });
    expect((await call(api, "/api/state", { host: LOCAL })).status).toBe(200);
    expect((await call(api, "/api/sessions", { host: LOCAL, body: { secret: SECRET } })).status).toBe(404);
    expect((await call(api, "/api/state", { host: "office.example.ts.net" })).status).toBe(403);
  });
});

describe("an office that answers at an address", () => {
  it("answers at that address and on this machine, and asks both for a session", async () => {
    const api = open();

    expect(await (await call(api, "/api/meta")).json()).toEqual({ contract: CONTRACT, requiresSession: true });
    expect((await call(api, "/api/state")).status).toBe(401);
    expect((await call(api, "/api/state", { host: LOCAL })).status).toBe(401);
    expect((await call(api, "/api/events", { host: LOCAL })).status).toBe(401);
    expect((await call(api, "/api/state", { host: "elsewhere.example" })).status).toBe(403);
  });

  it("asks nothing of what is not the API, so its own console can load and pair", async () => {
    expect((await call(open(), "/index.html")).status).toBe(404);
    expect((await call(open(), "/api-docs")).status).toBe(404);
  });

  it("gives a session for the pairing secret, and that session opens the state, the commands and the events", async () => {
    const api = open();

    const response = await call(api, "/api/sessions", { body: { secret: SECRET } });
    const { token, expiresAt } = (await response.json()) as { token: string; expiresAt: string };

    expect(response.status).toBe(200);
    expect(expiresAt).toBe("2026-11-11T09:00:00.000Z");
    expect((await call(api, "/api/state", { session: token })).status).toBe(200);
    expect((await call(api, "/api/commands/send-message", { session: token, body: { text: "Add an export" } })).status).toBe(202);
    const events = await call(api, "/api/events", { session: token });
    expect(events.status).toBe(200);
    await events.body?.cancel();
  });

  it("refuses a wrong secret, a session past its date, one signed by another office and one that was altered", async () => {
    const api = open();
    const token = await paired(api);
    const [header, , signature] = token.split(".");
    const forever = Buffer.from(JSON.stringify({ sub: "director", exp: 9_999_999_999 })).toString("base64url");

    expect((await call(api, "/api/sessions", { body: { secret: "a guess" } })).status).toBe(401);
    expect((await call(api, "/api/sessions", { body: {} })).status).toBe(400);
    expect((await call(api, "/api/state", { session: issueSession(access({ key: Buffer.from("another-office") })).token })).status).toBe(401);
    expect((await call(api, "/api/state", { session: `${header}.${forever}.${signature}` })).status).toBe(401);
    expect((await call(api, "/api/state", { session: "not-a-session" })).status).toBe(401);

    now += 31 * 24 * 60 * 60 * 1000;
    expect((await call(api, "/api/state", { session: token })).status).toBe(401);
  });

  it("stops listening to secrets for a minute after five wrong ones, the right one included", async () => {
    const api = open();
    for (let guess = 0; guess < 5; guess++) expect((await call(api, "/api/sessions", { body: { secret: `guess ${guess}` } })).status).toBe(401);

    expect((await call(api, "/api/sessions", { body: { secret: SECRET } })).status).toBe(429);

    now += 61_000;
    expect((await call(api, "/api/sessions", { body: { secret: SECRET } })).status).toBe(200);
  });

  it("lets its studio call from a browser, and no other page", async () => {
    const api = open();
    const session = await paired(api);

    const preflight = await call(api, "/api/commands/send-message", { method: "OPTIONS", origin: STUDIO });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(STUDIO);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

    const read = await call(api, "/api/state", { origin: STUDIO, session });
    expect(read.status).toBe(200);
    expect(read.headers.get("access-control-allow-origin")).toBe(STUDIO);
    expect((await call(api, "/api/commands/send-message", { origin: STUDIO, session, body: { text: "Add an export" } })).status).toBe(202);

    const stranger = await call(api, "/api/state", { origin: "https://elsewhere.example", session });
    expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
    expect((await call(api, "/api/commands/send-message", { origin: "https://elsewhere.example", session, body: { text: "Add an export" } })).status).toBe(403);
    expect((await call(api, "/api/sessions", { origin: "https://elsewhere.example", body: { secret: SECRET } })).status).toBe(403);
  });
});

describe("reading where the office answers", () => {
  it("stays on this machine when no address is given", async () => {
    expect(await readOfficeAccess({}, dataDir)).toBeUndefined();
  });

  it("keeps one pairing secret and one key across restarts, readable by the owner alone", async () => {
    const env = { SKYNOT_OFFICE_URL: `${OFFICE}/some/path` };

    const first = await readOfficeAccess(env, dataDir);
    const second = await readOfficeAccess(env, dataDir);

    expect(first).toMatchObject({ address: OFFICE, studios: ["https://skynot-labs.github.io"] });
    expect(second?.secret).toBe(first?.secret);
    expect(second?.key.equals(first!.key)).toBe(true);
    expect((await readFile(path.join(dataDir, "pairing.secret"), "utf8")).trim()).toBe(first?.secret);
    expect((await stat(path.join(dataDir, "pairing.secret"))).mode & 0o777).toBe(0o600);
    expect((await stat(path.join(dataDir, "session.key"))).mode & 0o777).toBe(0o600);
  });

  it("refuses an address a session would cross in the clear, except this machine's own", async () => {
    await expect(readOfficeAccess({ SKYNOT_OFFICE_URL: "http://office.example" }, dataDir)).rejects.toThrow("SKYNOT_OFFICE_URL must use https");
    await expect(readOfficeAccess({ SKYNOT_OFFICE_URL: "office.example" }, dataDir)).rejects.toThrow("must be an address");
    await expect(readOfficeAccess({ SKYNOT_OFFICE_URL: OFFICE, SKYNOT_STUDIO: "http://studio.example" }, dataDir)).rejects.toThrow("SKYNOT_STUDIO must use https");
    expect(await readOfficeAccess({ SKYNOT_OFFICE_URL: "http://127.0.0.1:4747", SKYNOT_STUDIO: "http://localhost:5173/" }, dataDir)).toMatchObject({ address: "http://127.0.0.1:4747", studios: ["http://localhost:5173"] });
  });

  it("writes a pairing link the studio can read back", () => {
    const link = new URL(pairingLink("https://studio.example/app/", { address: OFFICE, secret: SECRET }));

    expect(`${link.origin}${link.pathname}`).toBe("https://studio.example/app/");
    expect(Object.fromEntries(new URLSearchParams(link.hash.slice(1)))).toEqual({ office: OFFICE, secret: SECRET });
  });
});
