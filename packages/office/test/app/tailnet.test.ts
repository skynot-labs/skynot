import { describe, expect, it } from "vitest";
import { shareOnTailnet } from "../../src/app/tailnet";
import { TIMED_OUT, type Exec, type ExecResult } from "../../src/kernel/process";

const answer = (stdout: string, code = 0, stderr = ""): ExecResult => ({ stdout, stderr, code });
const joined = answer(JSON.stringify({ BackendState: "Running", Self: { DNSName: "skynot-dev.tail1234.ts.net." } }));

function tailscale(answers: { status?: ExecResult | "missing"; serve?: ExecResult }) {
  const calls: string[][] = [];
  const exec: Exec = async (command, args) => {
    calls.push([command, ...args]);
    const result = args[0] === "status" ? answers.status : answers.serve;
    if (result === undefined || result === "missing") throw new Error("spawn tailscale ENOENT");
    return result;
  };
  return { exec, calls };
}

describe("sharing the office on a tailnet", () => {
  it("shares the console's port and gives the HTTPS address the office is now reached at", async () => {
    const { exec, calls } = tailscale({ status: joined, serve: answer("Serve started and running in the background.") });

    expect(await shareOnTailnet(exec, 4747)).toEqual({ ok: true, value: "https://skynot-dev.tail1234.ts.net" });
    expect(calls).toEqual([
      ["tailscale", "status", "--json"],
      ["tailscale", "serve", "--bg", "4747"],
    ]);
  });

  it("says how to install Tailscale when it is not there, and shares nothing", async () => {
    const { exec, calls } = tailscale({ status: "missing" });

    expect(await shareOnTailnet(exec, 4747)).toMatchObject({ ok: false, error: expect.stringContaining("Tailscale is not installed") });
    expect(calls).toHaveLength(1);
  });

  it("says to start the daemon when it is down, and not to join again", async () => {
    const down = answer("", 1, "failed to connect to local tailscaled (no tailscaled process found): Failed to connect to local Tailscale daemon for /localapi/v0/status; not running?");
    const { exec, calls } = tailscale({ status: down });

    const shared = await shareOnTailnet(exec, 4747);

    expect(shared).toMatchObject({ ok: false, error: expect.stringContaining("its daemon is not running") });
    expect(shared).not.toMatchObject({ error: expect.stringContaining("tailscale up") });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["logged out", answer(JSON.stringify({ BackendState: "NeedsLogin", Self: { DNSName: "" } }))],
    ["stopped", answer(JSON.stringify({ BackendState: "Stopped", Self: { DNSName: "skynot-dev.tail1234.ts.net." } }))],
    ["answering with something that is not its status", answer("not a status", 1)],
  ])("says how to join when Tailscale is %s, and shares nothing", async (_state, status) => {
    const { exec, calls } = tailscale({ status });

    expect(await shareOnTailnet(exec, 4747)).toMatchObject({ ok: false, error: expect.stringContaining("sudo tailscale up --operator=$USER") });
    expect(calls).toHaveLength(1);
  });

  it("passes on Tailscale's own link when Serve is not enabled for the tailnet, whether it answers or waits", async () => {
    const link = "Serve is not enabled on your tailnet.\nTo enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc";

    for (const serve of [answer(link, 1), answer(link, TIMED_OUT)]) {
      const shared = await shareOnTailnet(tailscale({ status: joined, serve }).exec, 4747);
      expect(shared).toMatchObject({ ok: false, error: expect.stringContaining("https://login.tailscale.com/f/serve?node=abc") });
    }
  });

  it("says how to let this user share when only an administrator may", async () => {
    const { exec } = tailscale({ status: joined, serve: answer("", 1, "Access denied: serve config denied\n\nUse 'sudo tailscale serve --bg 4747'\nTo not require root, use 'sudo tailscale set --operator=$USER' once.") });

    expect(await shareOnTailnet(exec, 4747)).toMatchObject({ ok: false, error: expect.stringContaining("sudo tailscale set --operator=$USER") });
  });

  it("repeats what Tailscale said for a failure it does not know", async () => {
    const { exec } = tailscale({ status: joined, serve: answer("", 1, "listener already exists for port 443") });

    expect(await shareOnTailnet(exec, 4747)).toMatchObject({ ok: false, error: expect.stringContaining("listener already exists for port 443") });
  });
});
