import { describe, expect, it } from "vitest";
import { changedFiles, changedLines, holdReason, type MergeFacts } from "../../src/governance";

const diffOf = (files: Record<string, number>) =>
  Object.entries(files)
    .map(([file, lines]) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -0,0 +1 @@", ...Array.from({ length: lines }, (_, index) => `+line ${index}`)].join("\n"))
    .join("\n");

const rule = { maxChangedLines: 300, never: ["docs/legal/"] };
const facts = (overrides: Partial<MergeFacts> = {}): MergeFacts => ({
  review: { verdict: "approved", diffOnly: false },
  risk: "low",
  verifyCommands: ["npm run typecheck", "npm test"],
  upToDate: true,
  conflicts: false,
  diff: diffOf({ "packages/core/src/merge.ts": 40, "packages/core/test/merge.test.ts": 60 }),
  protectedPaths: [".github/", "AGENTS.md"],
  ...overrides,
});

describe("merging an order on its own", () => {
  it("lets through an approved, low-risk, small change built on the current base that touches nothing sensitive", () => {
    expect(holdReason(rule, facts())).toBeNull();
  });

  it("holds it for the director, saying why, when any one condition fails", () => {
    expect(holdReason(rule, facts({ review: { verdict: "changes_requested", diffOnly: false } }))).toBe("the reviewer did not approve it");
    expect(holdReason(rule, facts({ review: { verdict: "approved", diffOnly: true } }))).toContain("from the diff alone");
    expect(holdReason(rule, facts({ risk: "medium" }))).toBe("its risk is medium");
    expect(holdReason(rule, facts({ verifyCommands: ["true"] }))).toBe("the project's verify commands check nothing yet");
    expect(holdReason(rule, facts({ verifyCommands: [" : ", "true"] }))).toBe("the project's verify commands check nothing yet");
    expect(holdReason(rule, facts({ conflicts: true }))).toBe("it conflicts with the base branch");
    expect(holdReason(rule, facts({ upToDate: false }))).toBe("it was not built on the current base branch");
    expect(holdReason(rule, facts({ diff: diffOf({ "src/big.ts": 301 }) }))).toBe("it changes 301 lines, more than the 300 allowed");
    expect(holdReason(rule, facts({ diff: diffOf({ ".github/workflows/ci.yml": 3 }) }))).toBe("it touches .github/workflows/ci.yml, which the director merges");
    expect(holdReason(rule, facts({ diff: diffOf({ "docs/legal/terms.md": 3 }) }))).toBe("it touches docs/legal/terms.md, which the director merges");
  });

  it("holds a change whose paths look like accounts, money or stored data, by folder or by file", () => {
    for (const file of ["apps/api/src/auth.ts", "apps/api/src/db/schema.ts", "src/payments/stripe.ts", "db/migrations/0001.sql", "src/Sessions.ts", "src/billing.ts"]) {
      expect(holdReason(rule, facts({ diff: diffOf({ [file]: 3 }) }))).toContain("looks like accounts, money or stored data");
    }
    expect(holdReason(rule, facts({ diff: diffOf({ "src/todo.ts": 3 }) }))).toBeNull();
  });

  it("counts added and removed lines, not the file headers, and reads both sides of a rename", () => {
    const diff = ["diff --git a/old.ts b/new.ts", "--- a/old.ts", "+++ b/new.ts", "@@ -1,2 +1,2 @@", "-a", "+b", " c"].join("\n");

    expect(changedLines(diff)).toBe(2);
    expect(changedFiles(diff)).toEqual(["old.ts", "new.ts"]);
  });
});
