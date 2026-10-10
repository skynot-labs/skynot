import { describe, expect, it } from "vitest";
import { CANCELLED, TIMED_OUT, exec } from "../../src/kernel/process";

describe("exec", () => {
  it("returns the output and the exit code of a command", async () => {
    expect(await exec("sh", ["-c", "echo out; echo err >&2; exit 3"])).toEqual({ stdout: "out\n", stderr: "err\n", code: 3 });
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
