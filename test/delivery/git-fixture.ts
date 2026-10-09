import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { exec, run } from "../../src/kernel/process";

const IDENTITY = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
};

export const git = (cwd: string, ...args: string[]) => run(exec, "git", args, { cwd, env: { ...process.env, ...IDENTITY } });

export interface Sandbox {
  root: string;
  origin: string;
  cleanup(): Promise<void>;
}

export async function createSandbox(files: Record<string, string> = defaultFiles): Promise<Sandbox> {
  const root = await mkdtemp(path.join(tmpdir(), "skynot-git-"));
  const seed = path.join(root, "seed");
  const origin = path.join(root, "origin.git");

  await mkdir(seed);
  await git(seed, "init", "-b", "main");
  await addFiles(seed, files);
  await git(seed, "add", "-A");
  await git(seed, "commit", "-m", "initial");
  await git(root, "clone", "--bare", seed, origin);

  return { root, origin, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export async function addFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
}

export const defaultFiles = {
  "README.md": "# demo\n",
  "src/app.txt": "app\n",
  "test/app.test.txt": "a test\n",
};

export const cloneFrom = (origin: string) => (_repo: string, dir: string) => run(exec, "git", ["clone", "--quiet", origin, dir]).then(() => undefined);
