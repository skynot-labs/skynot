import { describe, expect, it } from "vitest";
import { askedQuestion, deletedTest, issueBody, issueTitle, pullRequestBody, workerPrompt, type WorkItem } from "../../src/delivery";

const item: WorkItem = {
  id: "WO-0042",
  title: "Export the inventory to CSV",
  objective: "The director can download the inventory as CSV.",
  criteria: [
    { statement: "Archived items are not exported", verification: { kind: "test", detail: "export.test.ts" } },
  ],
  outOfScope: ["Excel export"],
  risk: "low",
  likelyFiles: ["src/export.ts"],
  card: "WO-0042  Export the inventory to CSV\nstatus   ? needs your signature",
};

describe("the worker's question", () => {
  it.each([
    ["I read the code.\nQUESTION: Which date format?", "Which date format?"],
    ["QUESTION: first\nsomething else\nQUESTION: the last one counts", "the last one counts"],
    ["  QUESTION:    padded   ", "padded"],
  ])("takes the last line that starts with the mark: %j", (report, expected) => {
    expect(askedQuestion(report)).toBe(expected);
  });

  it("ignores a report without one, an empty one, and cuts a long one", () => {
    expect(askedQuestion("all done, see tests")).toBeNull();
    expect(askedQuestion("QUESTION:")).toBeNull();
    expect(askedQuestion("QUESTION: ??")).toBeNull();
    expect(askedQuestion(`QUESTION: ${"x".repeat(900)}`)).toHaveLength(300);
  });

  it("is offered in the prompt, together with the answers the director already gave", () => {
    const prompt = workerPrompt({ ...item, answers: ["Which format? → ISO 8601"] }, 7, { protectedPaths: [], verifyCommands: ["npm test"] });

    expect(prompt).toContain("end your report with one line, `QUESTION:");
    expect(prompt).toContain("Follow these answers:\n- Which format? → ISO 8601");
    expect(workerPrompt(item, 7, { protectedPaths: [], verifyCommands: [] })).not.toContain("Follow these answers");
  });
});

describe("issue and pull request text", () => {
  it("titles the issue with the order id", () => {
    expect(issueTitle(item)).toBe("WO-0042 Export the inventory to CSV");
  });

  it("puts the card first in the issue, then the criteria with how each is verified", () => {
    const body = issueBody(item);
    expect(body.startsWith("```\nWO-0042  Export the inventory to CSV")).toBe(true);
    expect(body).toContain("- [ ] Archived items are not exported\n  - Verify (test): export.test.ts");
    expect(body).toContain("## Out of scope\n- Excel export");
    expect(body).toContain("`src/export.ts`");
  });

  it("says plainly when nothing is declared", () => {
    const body = issueBody({ ...item, outOfScope: [], likelyFiles: [] });
    expect(body).toContain("- Nothing declared.");
    expect(body).toContain("- Not identified.");
  });

  it("makes the pull request close the issue and carry the worker's evidence", () => {
    const body = pullRequestBody(item, 12, "All criteria covered by export.test.ts");
    expect(body.startsWith("Closes #12")).toBe(true);
    expect(body).toContain("All criteria covered by export.test.ts");
    expect(pullRequestBody(item, 12, "")).toContain("No report.");
  });
});

describe("worker prompt", () => {
  const rules = { protectedPaths: [".github/"], verifyCommands: ["npm test"] };

  it("states the objective, the evidence required, the commands to run and the paths to avoid", () => {
    const prompt = workerPrompt(item, 12, rules);
    expect(prompt).toContain("work order WO-0042 (issue #12)");
    expect(prompt).toContain("Archived items are not exported (verify, test: export.test.ts)");
    expect(prompt).toContain("each exactly as written, one per call: npm test.");
    expect(prompt).toContain("Do not touch: .github/.");
    expect(prompt).toContain("Do not commit or push");
  });

  it("includes the failed verification output only on a repair round", () => {
    expect(workerPrompt(item, 12, rules)).not.toContain("previous attempt");
    expect(workerPrompt(item, 12, rules, "$ npm test\n1 failed")).toContain("previous attempt failed verification");
  });
});

describe("deleted tests", () => {
  it("finds a deleted test file by its location or its name", () => {
    expect(deletedTest([{ status: "D", path: "test/export.ts" }])).toBe("test/export.ts");
    expect(deletedTest([{ status: "D", path: "src/export.spec.ts" }])).toBe("src/export.spec.ts");
  });

  it("ignores deleted non-test files and modified or new tests", () => {
    expect(deletedTest([{ status: "D", path: "src/old.ts" }])).toBeUndefined();
    expect(deletedTest([{ status: "M", path: "test/export.test.ts" }, { status: "A", path: "test/new.test.ts" }])).toBeUndefined();
  });
});
