import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GithubAppTokens, asGithubApp } from "../../src/delivery";
import type { Exec, ExecOptions } from "../../src/kernel/process";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const START = Date.parse("2026-10-10T12:00:00Z");

function github(installations: Array<{ id: number; account: { login: string } }> = [{ id: 7, account: { login: "acme" } }]) {
  const calls: Array<{ method: string; path: string; jwt: string }> = [];
  let minted = 0;
  const clock = { now: START };
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://api.github.com", "");
    calls.push({ method: init?.method ?? "GET", path, jwt: (init?.headers as Record<string, string>).authorization!.replace("Bearer ", "") });
    if (path === "/app/installations") return Response.json(installations);
    if (path === "/app/installations/403/access_tokens") return new Response("Bad credentials", { status: 401 });
    return Response.json({ token: `token-${++minted}`, expires_at: new Date(clock.now + 3_600_000).toISOString() });
  }) as typeof fetch;
  return { calls, clock, options: { appId: "42", privateKey: pem, fetch: fake, now: () => clock.now } };
}

describe("the tokens of a GitHub App", () => {
  it("signs as the app, finds its only installation and asks for a token", async () => {
    const { calls, options } = github();

    expect(await new GithubAppTokens(options).token()).toBe("token-1");

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /app/installations", "POST /app/installations/7/access_tokens"]);
    const [header, claims, signature] = calls[0]!.jwt.split(".");
    expect(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature!, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({ iss: "42", iat: START / 1000 - 60 });
  });

  it("keeps a token while it is good and asks for another shortly before it expires", async () => {
    const { calls, clock, options } = github();
    const tokens = new GithubAppTokens({ ...options, installationId: "9" });

    expect(await Promise.all([tokens.token(), tokens.token()])).toEqual(["token-1", "token-1"]);
    clock.now += 50 * 60_000;
    expect(await tokens.token()).toBe("token-1");
    clock.now += 6 * 60_000;
    expect(await tokens.token()).toBe("token-2");
    expect(calls.map((call) => call.path)).toEqual(["/app/installations/9/access_tokens", "/app/installations/9/access_tokens"]);
  });

  it("does not guess between installations, and says what GitHub answered when it refuses", async () => {
    const two = github([{ id: 1, account: { login: "acme" } }, { id: 2, account: { login: "other" } }]);
    await expect(new GithubAppTokens(two.options).token()).rejects.toThrow("acme (1), other (2)");
    await expect(new GithubAppTokens(github([]).options).token()).rejects.toThrow("nowhere");

    const refused = new GithubAppTokens({ ...github().options, installationId: "403" });
    await expect(refused.token()).rejects.toThrow("(401): Bad credentials");
    await expect(refused.token()).rejects.toThrow("(401)");
  });
});

describe("running gh and git as the app", () => {
  const seen: Array<{ command: string; options: ExecOptions | undefined }> = [];
  const record: Exec = async (command, _args, options) => (seen.push({ command, options }), { stdout: "", stderr: "", code: 0 });
  const execute = asGithubApp(record, { token: async () => "secret" });

  it("gives the token to gh and to git, keeping the environment the caller asked for", async () => {
    await execute("gh", ["api", "user"]);
    await execute("git", ["push"], { cwd: "/repo", env: { GIT_AUTHOR_NAME: "shop" } });

    expect(seen[0]!.options!.env).toMatchObject({ GH_TOKEN: "secret" });
    expect(seen[1]!.options).toMatchObject({ cwd: "/repo", env: { GIT_AUTHOR_NAME: "shop", GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader" } });
    expect(seen[1]!.options!.env!.GIT_CONFIG_VALUE_1).toBe(`AUTHORIZATION: basic ${Buffer.from("x-access-token:secret").toString("base64")}`);
  });

  it("gives nothing to any other command, such as the project's own test run", async () => {
    await execute("sh", ["-c", "npm test"], { cwd: "/repo" });

    expect(seen.at(-1)).toEqual({ command: "sh", options: { cwd: "/repo" } });
  });
});
