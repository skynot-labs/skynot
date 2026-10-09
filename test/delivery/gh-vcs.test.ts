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

  it("fails loudly with gh's own message when the API refuses", async () => {
    const { execute } = recordingExec("", 1);

    await expect(new GhVcs(execute).createIssue("a/b", "T", "B")).rejects.toThrow(/HTTP 403/);
  });
});
