import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "../../kernel";
import type { EngineFailure, EngineRequest, EngineResult, LoginStatus, RoleEngine } from "../domain";
import { TIMED_OUT, exec, type Exec } from "../../kernel/process";

export function codexArgs(request: EngineRequest, files: { schema?: string; out: string }): string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--color", "never",
    "-s", request.access === "write" ? "workspace-write" : "read-only",
    "-C", request.cwd,
    "-o", files.out,
    ...(files.schema ? ["--output-schema", files.schema] : []),
    ...(request.model ? ["-m", request.model] : []),
    "-",
  ];
}

async function isolatedHome(parent: string): Promise<string> {
  const home = join(parent, "home");
  await mkdir(home);
  const realHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  await symlink(join(realHome, "auth.json"), join(home, "auth.json"));
  return home;
}

export class CodexEngine implements RoleEngine {
  constructor(private readonly execute: Exec = exec) {}

  async run(request: EngineRequest): Promise<Result<EngineResult, EngineFailure>> {
    const dir = await mkdtemp(join(tmpdir(), "skynot-codex-"));
    try {
      const out = join(dir, "last-message.txt");
      const schema = request.schema ? join(dir, "schema.json") : undefined;
      if (schema) await writeFile(schema, JSON.stringify(request.schema));
      const prompt = request.system ? `${request.system}\n\n---\n\n${request.prompt}` : request.prompt;

      const result = await this.execute("codex", codexArgs(request, { out, ...(schema && { schema }) }), {
        cwd: request.cwd,
        input: prompt,
        timeoutMs: request.timeoutMs,
        env: { ...process.env, CODEX_HOME: await isolatedHome(dir) },
      });
      if (result.code === TIMED_OUT) return err({ kind: "timeout", message: "codex timed out" });

      const text = await readFile(out, "utf8").catch(() => "");
      if (result.code !== 0 || !text.trim()) {
        return err({ kind: "failed", message: `codex failed (${result.code}): ${result.stderr.trim().slice(-400)}` });
      }
      return ok({
        text,
        structured: schema ? parseJson(text) : undefined,
        costUsd: 0,
        turns: 0,
        model: /^model:\s*(.+)$/m.exec(`${result.stderr}\n${result.stdout}`)?.[1] ?? "codex",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async loginStatus(): Promise<LoginStatus> {
    try {
      const { stdout, code } = await this.execute("codex", ["login", "status"]);
      return code === 0 && /logged in/i.test(stdout)
        ? { loggedIn: true, detail: stdout.trim() }
        : { loggedIn: false, detail: "run `codex login`" };
    } catch {
      return { loggedIn: false, detail: "codex is not installed or did not answer" };
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
