import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandOutcome, FileChange, Workspace } from "../domain";

export class FakeWorkspace implements Workspace {
  readonly pushed: string[] = [];

  async prepare(): Promise<string> {
    return mkdtemp(join(tmpdir(), "skynot-fake-worktree-"));
  }

  async changes(): Promise<FileChange[]> {
    return [{ status: "A", path: "src/feature.txt" }];
  }

  async commit(): Promise<void> {}

  async push(_dir: string, branch: string): Promise<void> {
    this.pushed.push(branch);
  }

  async drop(_repo: string, dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
  }

  async run(): Promise<CommandOutcome> {
    return { ok: true, output: "" };
  }
}
