import { afterEach, describe, expect, it, vi } from "vitest";
import { OFFICE_PATIENCE_MS, addressProblem, forgetConnection, officeOrigin, pair, pairingFrom, rememberConnection, rememberedConnection } from "../src/application/connection";

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

describe("an address typed into a studio", () => {
  it("is fine over https from any studio", () => {
    expect(addressProblem(OFFICE, "https:")).toBeNull();
    expect(addressProblem("office.example.ts.net", "http:")).toBeNull();
  });

  it("may be an office on this machine over http when the studio is served over http too", () => {
    expect(addressProblem("http://127.0.0.1:4747", "http:")).toBeNull();
    expect(addressProblem("http://localhost:4747", "http:")).toBeNull();
  });

  it("cannot be an office on this machine from a studio served over https, and says what to use instead", () => {
    const problem = addressProblem("http://127.0.0.1:4747/", "https:");

    expect(problem).toContain("cannot reach an office on this machine at http://127.0.0.1:4747");
    expect(problem).toContain("Open the console the office serves itself at http://127.0.0.1:4747");
    expect(problem).toContain("npm run start:shared");
    expect(addressProblem("http://localhost:4747", "https:")).toContain("cannot reach an office on this machine");
  });

  it("is refused when it is not an address a session may travel to", () => {
    expect(addressProblem("http://office.example.ts.net", "https:")).toBe("Use the office's https address, such as https://office.example.ts.net.");
    expect(addressProblem("http://office.example.ts.net", "http:")).toBe("Use the office's https address. Plain http only works for an office on this machine.");
    expect(addressProblem("", "http:")).not.toBeNull();
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

  it("says where the secret is when the office refuses it", async () => {
    officeAnswers(401, { error: "that is not this office's pairing secret" });

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow(
      "That is not this office's pairing secret. Copy it from the pairing link the office printed when it started, or from the file pairing.secret in the office's data folder.",
    );
  });

  it("says which address the office must be started with when it was reached at another", async () => {
    officeAnswers(403, { error: "unknown host" });

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow(
      `The office was reached at ${OFFICE}, an address it was not started with. Start it with SKYNOT_OFFICE_URL set to exactly that address, scheme included.`,
    );
  });

  it("says how to pair with an office that takes no sessions", async () => {
    officeAnswers(404, { error: "this office takes no sessions: it answers on this machine only" });

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow("start it with its address in SKYNOT_OFFICE_URL");
  });

  it.each([
    [429, "too many wrong secrets: wait a minute"],
    [400, "the pairing secret is required"],
    [403, "cross-origin request refused"],
  ])("fails with the office's own reason on a %i", async (status, error) => {
    officeAnswers(status, { error });

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow(error);
  });

  it("still fails, and says what to check, when the refusal carries no reason", async () => {
    officeAnswers(502, "<html>Bad Gateway</html>");

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow(`${OFFICE} refused to pair (502), and not in an office's words. Check that it is your office's address and that the office is running.`);
  });

  it("fails when the answer holds no session, and says what to check", async () => {
    officeAnswers(200, { expiresAt: "2026-11-11T09:00:00.000Z" });

    await expect(pair(OFFICE, "a-secret")).rejects.toThrow(`${OFFICE} answered, but not with a session. Check that it is your office's address.`);
  });

  it("gives up on an office that never answers, as one that could not be reached", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));

    const failure = pair(OFFICE, "the-secret").catch((cause: Error) => cause.message);
    await vi.advanceTimersByTimeAsync(OFFICE_PATIENCE_MS);

    expect(await failure).toContain(`Could not reach the office at ${OFFICE}`);
  });

  it("says the office could not be reached, without repeating the secret", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const failure = await pair(OFFICE, "the-secret").catch((cause: Error) => cause.message);

    expect(failure).toBe(
      [
        `Could not reach the office at ${OFFICE}. Check, in this order:`,
        "1. The address is the one in the pairing link the office printed when it started.",
        "2. The office is running.",
        "3. The office accepts this studio. It takes calls from the public studio only, unless it was started with this studio's address in SKYNOT_STUDIO.",
        "4. The browser may reach your local network. If it asked and was refused, allow local network access for this site in the site's settings and reload.",
      ].join("\n"),
    );
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
