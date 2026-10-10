import { describe, expect, it } from "vitest";
import { GhVcs } from "../../src/delivery";
import type { Exec } from "../../src/kernel/process";

function recordingExec(stdout: string, code = 0) {
  const calls: string[][] = [];
  const execute: Exec = async (command, args) => {
    calls.push([command, ...args]);
    return { stdout, stderr: code === 0 ? "" : "HTTP 403", code };
  };
  return { execute, calls };
}

describe("gh vcs", () => {
  it("creates an issue through the API and returns its number and url", async () => {
    const { execute, calls } = recordingExec(JSON.stringify({ number: 7, html_url: "https://github.com/a/b/issues/7" }));

    const issue = await new GhVcs(execute).createIssue("a/b", "WO-0001 Title", "body text");

    expect(issue).toEqual({ number: 7, url: "https://github.com/a/b/issues/7" });
    expect(calls[0]).toEqual(["gh", "api", "-X", "POST", "repos/a/b/issues", "-f", "title=WO-0001 Title", "-f", "body=body text"]);
  });

  it("lists the open issues with a label, leaving out pull requests, and encodes the label", async () => {
    const { execute, calls } = recordingExec(
      JSON.stringify([
        { number: 7, title: "Dark mode", body: null, html_url: "https://github.com/a/b/issues/7" },
        { number: 8, title: "A pull request", body: "x", html_url: "https://github.com/a/b/pull/8", pull_request: {} },
      ]),
    );

    const tickets = await new GhVcs(execute).listTickets("a/b", "taller:ready");

    expect(tickets).toEqual([{ number: 7, title: "Dark mode", body: "", url: "https://github.com/a/b/issues/7" }]);
    expect(calls[0]).toEqual(["gh", "api", "repos/a/b/issues?state=open&per_page=30&labels=taller%3Aready"]);
  });

  it("adds a label to an issue", async () => {
    const { execute, calls } = recordingExec("[]");

    await new GhVcs(execute).addLabel("a/b", 7, "taller:implement");

    expect(calls[0]).toEqual(["gh", "api", "-X", "POST", "repos/a/b/issues/7/labels", "-f", "labels[]=taller:implement"]);
  });

  it("opens a pull request from the branch to the base", async () => {
    const { execute, calls } = recordingExec(JSON.stringify({ number: 9, html_url: "https://github.com/a/b/pull/9" }));

    const pr = await new GhVcs(execute).openPullRequest("a/b", { head: "taller/wo-0001", base: "main", title: "T", body: "B" });

    expect(pr).toEqual({ number: 9, url: "https://github.com/a/b/pull/9" });
    expect(calls[0]).toEqual(
      expect.arrayContaining(["repos/a/b/pulls", "title=T", "head=taller/wo-0001", "base=main", "body=B"]),
    );
  });

  it("tells open, merged and closed pull requests apart", async () => {
    const state = (body: object) => new GhVcs(recordingExec(JSON.stringify(body)).execute).pullRequestState("a/b", 9);

    expect(await state({ state: "open", merged_at: null })).toBe("open");
    expect(await state({ state: "closed", merged_at: "2026-10-09T12:00:00Z" })).toBe("merged");
    expect(await state({ state: "closed", merged_at: null })).toBe("closed");
  });

  describe("checks", () => {
    function checks(runs: Array<{ status: string; conclusion: string | null }>) {
      const execute: Exec = async (_command, args) => ({
        stdout: JSON.stringify(args.some((arg) => arg.includes("actions/runs")) ? { workflow_runs: runs } : { head: { sha: "abc" } }),
        stderr: "",
        code: 0,
      });
      return new GhVcs(execute).pullRequestChecks("a/b", 9);
    }
    const completed = (conclusion: string) => ({ status: "completed", conclusion });

    it("passes only when every run succeeded, was skipped or is neutral", async () => {
      expect(await checks([completed("success"), completed("skipped"), completed("neutral")])).toBe("passing");
      expect(await checks([])).toBe("none");
      expect(await checks([completed("success"), { status: "in_progress", conclusion: null }])).toBe("pending");
    });

    it("fails for any other conclusion, a workflow that could not start included", async () => {
      for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"]) {
        expect(await checks([completed("success"), completed(conclusion)])).toBe("failing");
      }
      expect(await checks([completed("startup_failure"), { status: "queued", conclusion: null }])).toBe("failing");
    });
  });

  it("fails loudly with gh's own message when the API refuses", async () => {
    const { execute } = recordingExec("", 1);

    await expect(new GhVcs(execute).createIssue("a/b", "T", "B")).rejects.toThrow(/HTTP 403/);
  });
});
