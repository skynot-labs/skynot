import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetConnection, officeOrigin, pair, pairingFrom, rememberConnection, rememberedConnection } from "../src/application/connection";

const OFFICE = "https://office.example.ts.net";

function browserStorage(kept: Record<string, string> = {}) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept[key] ?? null,
    setItem: (key: string, value: string) => void (kept[key] = value),
    removeItem: (key: string) => void delete kept[key],
  });
  return kept;
}

function blockedStorage() {
  const refuse = () => {
    throw new Error("storage is blocked");
  };
  vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse, removeItem: refuse });
}

afterEach(() => vi.unstubAllGlobals());

describe("an office's address", () => {
  it("is kept as its origin", () => {
    expect(officeOrigin("https://office.example.ts.net/some/page?x=1")).toBe(OFFICE);
    expect(officeOrigin("  https://office.example.ts.net:8443/ ")).toBe("https://office.example.ts.net:8443");
  });

  it("is taken as https when typed without a scheme", () => {
    expect(officeOrigin("office.example.ts.net")).toBe(OFFICE);
  });

  it("may use plain http only on this machine", () => {
    expect(officeOrigin("http://127.0.0.1:4747")).toBe("http://127.0.0.1:4747");
    expect(officeOrigin("http://localhost:4747/")).toBe("http://localhost:4747");
    expect(officeOrigin("http://office.example.ts.net")).toBeNull();
    expect(officeOrigin("http://192.168.1.20:4747")).toBeNull();
  });

  it("is refused when it is not a web address", () => {
    expect(officeOrigin("")).toBeNull();
    expect(officeOrigin("   ")).toBeNull();
    expect(officeOrigin("ftp://office.example.ts.net")).toBeNull();
    expect(officeOrigin("javascript://office.example.ts.net")).toBeNull();
    expect(officeOrigin("https://")).toBeNull();
  });
});

describe("a pairing link", () => {
  it("names the office and its secret in the fragment", () => {
    expect(pairingFrom(`#office=${encodeURIComponent(OFFICE)}&secret=s3cr3t-_x`)).toEqual({ office: OFFICE, secret: "s3cr3t-_x" });
    expect(pairingFrom(`#office=${encodeURIComponent("http://127.0.0.1:4747")}&secret=abc`)).toEqual({ office: "http://127.0.0.1:4747", secret: "abc" });
  });

  it("is not one when a part is missing or the office is not safe to reach", () => {
    expect(pairingFrom("")).toBeNull();
    expect(pairingFrom("#studio")).toBeNull();
    expect(pairingFrom(`#office=${encodeURIComponent(OFFICE)}`)).toBeNull();
    expect(pairingFrom(`#office=${encodeURIComponent(OFFICE)}&secret=`)).toBeNull();
    expect(pairingFrom("#secret=abc")).toBeNull();
    expect(pairingFrom(`#office=${encodeURIComponent("http://office.example.ts.net")}&secret=abc`)).toBeNull();
  });
});

describe("pairing with an office", () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  function officeAnswers(status: number, body: unknown) {
    calls.length = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    });
  }

  it("trades the secret for a session with that office", async () => {
    officeAnswers(200, { token: "a-session-token", expiresAt: "2026-11-11T09:00:00.000Z" });

    expect(await pair(OFFICE, "the-secret")).toEqual({ office: OFFICE, token: "a-session-token" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${OFFICE}/api/sessions`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("omit");
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ secret: "the-secret" });
  });

  it.each([
    [401, "that is not this office's pairing secret"],
    [429, "too many wrong secrets: wait a minute"],
    [404, "this office takes no sessions: it answers on this machine only"],
  ])("fails with the office's own reason on a %i", async (status, error) => {
    officeAnswers(status, { error });

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow(error);
  });

  it("still fails when the refusal carries no reason", async () => {
    officeAnswers(502, "<html>Bad Gateway</html>");

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow("502");
  });

  it("fails when the answer holds no session", async () => {
    officeAnswers(200, { expiresAt: "2026-11-11T09:00:00.000Z" });

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow("not with a session");
  });

  it("says the office could not be reached, without repeating the secret", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const failure = await pair(OFFICE, "the-secret").catch((cause: Error) => cause.message);

    expect(failure).toContain(`Could not reach the office at ${OFFICE}`);
    expect(failure).not.toContain("the-secret");
  });
});

describe("the remembered connection", () => {
  const connection = { office: OFFICE, token: "a-session-token" };

  it("is there on the next visit until it is forgotten", () => {
    browserStorage();
    expect(rememberedConnection()).toBeNull();

    rememberConnection(connection);
    expect(rememberedConnection()).toEqual(connection);

    forgetConnection();
    expect(rememberedConnection()).toBeNull();
  });

  it("is ignored when what was kept is not a connection", () => {
    for (const kept of ["not json", "{}", JSON.stringify({ office: OFFICE }), JSON.stringify({ office: "http://office.example.ts.net", token: "t" }), JSON.stringify({ office: OFFICE, token: 7 })]) {
      browserStorage({ "skynot.connection": kept });
      expect(rememberedConnection()).toBeNull();
    }
  });

  it("does not break the studio when the browser refuses storage", () => {
    blockedStorage();

    expect(rememberedConnection()).toBeNull();
    expect(() => rememberConnection(connection)).not.toThrow();
    expect(() => forgetConnection()).not.toThrow();
  });

  it("does not break the studio where there is no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(rememberedConnection()).toBeNull();
    expect(() => rememberConnection(connection)).not.toThrow();
  });
});
