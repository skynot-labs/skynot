import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CANCELLED, TIMED_OUT, exec } from "../../src/kernel/process";

describe("exec", () => {
  it("returns the output and the exit code of a command", async () => {
    expect(await exec("sh", ["-c", "echo out; echo err >&2; exit 3"])).toEqual({ stdout: "out\n", stderr: "err\n", code: 3 });
  });

  it("does not hand the tsconfig the office was started with to what it runs", async () => {
    const fixture = path.join(import.meta.dirname, "prints-child-env.fixture.ts");

    const office = await exec("npx", ["tsx", "--tsconfig", "packages/office/tsconfig.json", fixture]);

    expect(office).toMatchObject({ stdout: "none\n", code: 0 });
  });

  it("keeps multi-byte characters whole in a long output", async () => {
    const result = await exec("node", ["-e", "process.stdout.write('x' + 'é'.repeat(300000))"]);

    expect(result.stdout).toBe(`x${"é".repeat(300000)}`);
  });

  it("kills the whole process group when the timeout passes", async () => {
    const started = Date.now();

    const result = await exec("sh", ["-c", "sleep 5"], { timeoutMs: 100 });

    expect(result.code).toBe(TIMED_OUT);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("stops a running command, grandchildren included, when its signal is aborted", async () => {
    const stop = new AbortController();
    const started = Date.now();
    setTimeout(() => stop.abort(), 100);

    const result = await exec("sh", ["-c", "sleep 5; echo never"], { signal: stop.signal });

    expect(result.code).toBe(CANCELLED);
    expect(result.stdout).not.toContain("never");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("takes its running commands down when the process exits", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "skynot-exit-"));
    const pidFile = path.join(dir, "pid");
    const script = path.join(dir, "leaver.mts");
    await writeFile(
      script,
      `import { existsSync } from "node:fs";
       import { exec } from ${JSON.stringify(path.resolve(import.meta.dirname, "../../src/kernel/process.ts"))};
       void exec("sh", ["-c", "echo $$ > ${pidFile}; sleep 30"]);
       const poll = setInterval(() => { if (existsSync(${JSON.stringify(pidFile)})) { clearInterval(poll); process.exit(0); } }, 10);`,
    );

    await exec(process.execPath, ["--import", "tsx", script]);

    const pid = Number(await readFile(pidFile, "utf8"));
    expect(pid).toBeGreaterThan(0);
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
    await rm(dir, { recursive: true, force: true });
  });

  it("does not start work for a signal that is already aborted", async () => {
    const stop = new AbortController();
    stop.abort();

    const result = await exec("sh", ["-c", "sleep 5; echo never"], { signal: stop.signal });

    expect(result.code).toBe(CANCELLED);
    expect(result.stdout).not.toContain("never");
  });

  it("is not cancelled by a signal that is never aborted", async () => {
    expect(await exec("sh", ["-c", "echo fine"], { signal: new AbortController().signal })).toMatchObject({ code: 0, stdout: "fine\n" });
  });
});
