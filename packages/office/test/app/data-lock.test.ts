import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lockDataDir } from "../../src/app/data-lock";

let dataDir: string;
const lockFile = () => path.join(dataDir, "shop.lock");

beforeEach(async () => {
  dataDir = path.join(await mkdtemp(path.join(tmpdir(), "skynot-lock-")), "shop");
});

afterEach(() => rm(path.dirname(dataDir), { recursive: true, force: true }));

describe("data dir lock", () => {
  it("marks the data dir with this process and clears the mark on release", async () => {
    const release = await lockDataDir(dataDir);
    expect(await readFile(lockFile(), "utf8")).toBe(String(process.pid));

    release();

    await expect(readFile(lockFile(), "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("refuses a data dir held by another live process, and leaves its mark alone", async () => {
    await lockDataDir(dataDir);
    await writeFile(lockFile(), String(process.ppid));

    await expect(lockDataDir(dataDir)).rejects.toThrow(`already running on ${dataDir} (pid ${process.ppid})`);
    expect(await readFile(lockFile(), "utf8")).toBe(String(process.ppid));
  });

  it("takes over the mark of a process that is gone", async () => {
    await lockDataDir(dataDir);
    const gone = spawnSync("true").pid;
    await writeFile(lockFile(), String(gone));

    await lockDataDir(dataDir);

    expect(await readFile(lockFile(), "utf8")).toBe(String(process.pid));
  });

  it("takes over a mark that was left empty", async () => {
    await lockDataDir(dataDir);
    await writeFile(lockFile(), "");

    await lockDataDir(dataDir);

    expect(await readFile(lockFile(), "utf8")).toBe(String(process.pid));
  });
});
