import { createSign } from "node:crypto";
import type { Exec } from "../../kernel/process";

const API = "https://api.github.com";
const JWT_SECONDS = 540;
const RENEW_BEFORE_MS = 5 * 60_000;

export interface GithubAppOptions {
  appId: string;
  privateKey: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Granted {
  token: string;
  expiresAt: number;
}

// Tokens of a GitHub App: one per account it is installed in, each good for an hour, so the shop never holds a long-lived credential.
export class GithubAppTokens {
  private installations: Promise<Map<string, string>> | undefined;
  private readonly granted = new Map<string, Granted>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly options: GithubAppOptions) {}

  // Without an owner, the token of the only account the App is installed in.
  async token(owner?: string): Promise<string> {
    const installation = await this.installationOf(owner);
    const current = this.granted.get(installation);
    if (current && current.expiresAt - this.now() > RENEW_BEFORE_MS) return current.token;

    const asked = this.pending.get(installation) ?? this.mint(installation).finally(() => this.pending.delete(installation));
    this.pending.set(installation, asked);
    return asked;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async mint(installation: string): Promise<string> {
    const granted = (await this.call("POST", `/app/installations/${installation}/access_tokens`)) as { token: string; expires_at: string };
    this.granted.set(installation, { token: granted.token, expiresAt: Date.parse(granted.expires_at) });
    return granted.token;
  }

  private async installationOf(owner: string | undefined): Promise<string> {
    let accounts = await this.accounts();
    // installed somewhere new since the shop started
    if (owner && !accounts.has(owner.toLowerCase())) accounts = await this.accounts(true);
    const where = [...accounts.keys()].join(", ") || "nowhere";

    if (owner) {
      const found = accounts.get(owner.toLowerCase());
      if (!found) throw new Error(`the GitHub App is not installed in ${owner} (it is installed in ${where})`);
      return found;
    }
    if (accounts.size !== 1) throw new Error(`the GitHub App is installed in ${where}: which account is this for?`);
    return [...accounts.values()][0]!;
  }

  private accounts(again = false): Promise<Map<string, string>> {
    if (again || !this.installations) {
      const read = this.call("GET", "/app/installations?per_page=100").then(
        (list) => new Map((list as Array<{ id: number; account: { login: string } }>).map((entry) => [entry.account.login.toLowerCase(), String(entry.id)])),
      );
      this.installations = read;
      read.catch(() => this.installations === read && (this.installations = undefined));
    }
    return this.installations;
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

const OWNER_IN_ARG = [/(?:^|\/)repos\/([^/\s]+)\//, /github\.com[/:]([^/\s]+)\//];
const REPO = /^([\w.-]+)\/[\w.-]+$/;

// Which account a gh or git command is about: named in its arguments, or the origin of the clone it runs in.
export async function accountOf(execute: Exec, command: string, args: readonly string[], cwd?: string): Promise<string | undefined> {
  const flag = args.findIndex((arg) => arg === "--owner" || arg === "-R" || arg === "clone");
  const named = flag >= 0 ? args[flag + 1] : undefined;
  if (named) return REPO.exec(named)?.[1] ?? named;

  for (const arg of args) for (const pattern of OWNER_IN_ARG) if (pattern.test(arg)) return pattern.exec(arg)![1];
  if (command !== "git" || !cwd) return undefined;

  const origin = await execute("git", ["config", "--get", "remote.origin.url"], { cwd }).catch(() => null);
  return origin?.code === 0 ? OWNER_IN_ARG[1]!.exec(origin.stdout)?.[1] : undefined;
}

// gh reads the token from its environment; git gets it as a header, so no credential helper or stored login is involved.
// Give the account when the commands do not say it, as those that move a card of a board by its id.
export function asGithubApp(execute: Exec, tokens: Pick<GithubAppTokens, "token">, account?: string): Exec {
  return async (command, args, options = {}) => {
    if (command !== "gh" && command !== "git") return execute(command, args, options);
    const token = await tokens.token(account ?? (await accountOf(execute, command, args, options.cwd)));
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
