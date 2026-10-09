import { spawn } from "node:child_process";

export interface ExecOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export const TIMED_OUT = 124;

export type Exec = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export async function run(execute: Exec, command: string, args: string[], options?: ExecOptions): Promise<string> {
  const result = await execute(command, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(-600);
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed (${result.code}): ${detail}`);
  }
  return result.stdout;
}

export const exec: Exec = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs) : undefined;

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: signal ? TIMED_OUT : (code ?? 1) });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
