import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export const TIMED_OUT = 124;
export const CANCELLED = 125;

export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export async function run(execute: Exec, command: string, args: string[], options?: ExecOptions): Promise<string> {
  const result = await execute(command, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(-600);
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed (${result.code}): ${detail}`);
  }
  return result.stdout;
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
}

// tsx exports the tsconfig the office was started with, and a project's own tsx would read it as its own.
delete process.env.TSX_TSCONFIG_PATH;

// Each child leads its own process group, so no signal sent to this process reaches it.
const running = new Set<number>();
process.on("exit", () => running.forEach(killGroup));

export const exec: Exec = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    const pid = child.pid;
    if (pid !== undefined) running.add(pid);
    const settled = () => {
      clearTimeout(timer);
      if (pid !== undefined) running.delete(pid);
    };
    let stdout = "";
    let stderr = "";
    // Kill the whole group: a shell's grandchildren would otherwise keep the pipes open.
    const timer = options.timeoutMs ? setTimeout(() => killGroup(child.pid), options.timeoutMs) : undefined;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      killGroup(child.pid);
    };
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener("abort", cancel, { once: true });

    // decoding each chunk on its own breaks a character split across two of them
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      settled();
      reject(error);
    });
    child.on("close", (code, signal) => {
      settled();
      options.signal?.removeEventListener("abort", cancel);
      resolve({ stdout, stderr, code: cancelled ? CANCELLED : signal ? TIMED_OUT : (code ?? 1) });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
