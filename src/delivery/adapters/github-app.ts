import { createSign } from "node:crypto";
import type { Exec } from "../../kernel/process";

const API = "https://api.github.com";
const JWT_SECONDS = 540;
const RENEW_BEFORE_MS = 5 * 60_000;

export interface GithubAppOptions {
  appId: string;
  privateKey: string;
  installationId?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

// Tokens of a GitHub App installation: they last an hour, so the shop never holds a long-lived credential.
export class GithubAppTokens {
  private current: { token: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;
  private installation: string | undefined;

  constructor(private readonly options: GithubAppOptions) {
    this.installation = options.installationId;
  }

  token(): Promise<string> {
    if (this.current && this.current.expiresAt - this.now() > RENEW_BEFORE_MS) return Promise.resolve(this.current.token);
    this.pending ??= this.mint().finally(() => (this.pending = undefined));
    return this.pending;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async mint(): Promise<string> {
    this.installation ??= await this.onlyInstallation();
    const granted = (await this.call("POST", `/app/installations/${this.installation}/access_tokens`)) as { token: string; expires_at: string };
    this.current = { token: granted.token, expiresAt: Date.parse(granted.expires_at) };
    return granted.token;
  }

  private async onlyInstallation(): Promise<string> {
    const installations = (await this.call("GET", "/app/installations")) as Array<{ id: number; account: { login: string } }>;
    if (installations.length === 1) return String(installations[0]!.id);
    const where = installations.map((entry) => `${entry.account.login} (${entry.id})`).join(", ") || "nowhere";
    throw new Error(`the GitHub App is installed in ${where}: install it in one account, or name the installation`);
  }

  private async call(method: string, path: string): Promise<unknown> {
    const response = await (this.options.fetch ?? fetch)(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.jwt()}`, accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub App ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return response.json();
  }

  private jwt(): string {
    const seconds = Math.floor(this.now() / 1000);
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    // issued a minute ago: GitHub rejects a token from a clock that runs ahead of its own
    const body = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + JWT_SECONDS, iss: this.options.appId })}`;
    return `${body}.${createSign("RSA-SHA256").update(body).sign(this.options.privateKey, "base64url")}`;
  }
}

// gh reads the token from its environment; git gets it as a header, so no credential helper or stored login is involved.
export function asGithubApp(execute: Exec, tokens: Pick<GithubAppTokens, "token">): Exec {
  return async (command, args, options = {}) => {
    if (command !== "gh" && command !== "git") return execute(command, args, options);
    const token = await tokens.token();
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    return execute(command, args, {
      ...options,
      env: {
        ...(options.env ?? process.env),
        GH_TOKEN: token,
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "credential.helper",
        GIT_CONFIG_VALUE_0: "",
        GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
        GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${basic}`,
      },
    });
  };
}
