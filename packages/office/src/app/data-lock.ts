import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function isRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Two shops on one data dir give events the same sequence numbers, and the next start drops one of each pair.
export async function lockDataDir(dataDir: string): Promise<() => void> {
  const file = join(dataDir, "shop.lock");
  await mkdir(dataDir, { recursive: true });

  for (;;) {
    try {
      await writeFile(file, String(process.pid), { flag: "wx" });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const owner = Number(await readFile(file, "utf8").catch(() => ""));
    // our own pid means a shop that died in a container whose pids start over
    if (owner !== process.pid && isRunning(owner)) {
      throw new Error(`a shop is already running on ${dataDir} (pid ${owner}). If that process is not a shop, delete ${file}`);
    }
    await rm(file, { force: true });
  }
}
