import { describe, expect, it } from "vitest";
import { checkBranch, checkLabel, protectedPathsTouched, repoPolicy } from "../../src/governance";
import { examplePolicy } from "./fixtures";

const policy = examplePolicy();
const repo = policy.repos[0]!;

describe("guard", () => {
  it("finds an allowed repo and refuses an unknown one", () => {
    expect(repoPolicy(policy, "acme/widgets")).toMatchObject({ ok: true, value: { name: "acme/widgets" } });
    expect(repoPolicy(policy, "acme/other")).toMatchObject({ ok: false, error: { kind: "repo_not_allowed" } });
  });

  it("only allows branches under the configured prefix", () => {
    expect(checkBranch(policy, "taller/wo-0001").ok).toBe(true);
    expect(checkBranch(policy, "main")).toMatchObject({ ok: false, error: { kind: "branch_outside_prefix" } });
  });

  it("only allows labels under the configured prefix", () => {
    expect(checkLabel(policy, "taller:implement").ok).toBe(true);
    expect(checkLabel(policy, "bug")).toMatchObject({ ok: false, error: { kind: "label_outside_prefix" } });
  });
});

describe("protected paths", () => {
  const touched = (...paths: string[]) => protectedPathsTouched(repo, paths);

  it("flags files inside a protected directory", () => {
    expect(touched(".github/workflows/ci.yml", "src/app.ts")).toEqual([".github/workflows/ci.yml"]);
  });

  it("flags an exact file and a wildcard prefix", () => {
    expect(touched("AGENTS.md", "vitest.config.ts", "docs/AGENTS.md")).toEqual(["AGENTS.md", "vitest.config.ts"]);
  });

  it("ignores case differences, since the filesystem may", () => {
    expect(touched(".GitHub/workflows/ci.yml", "agents.md")).toEqual([".GitHub/workflows/ci.yml", "agents.md"]);
  });

  it("sees through path tricks that land in a protected directory", () => {
    expect(touched("./.github/ci.yml", "src/../.github/workflows/ci.yml")).toHaveLength(2);
  });

  it("flags paths that escape the repository", () => {
    expect(touched("../outside.txt", "/etc/passwd")).toHaveLength(2);
  });

  it("does not flag look-alike names", () => {
    expect(touched(".github-actions/notes.md", "src/github/client.ts", "README.md")).toEqual([]);
  });
});
