import { describe, expect, it } from "vitest";
import { followUpFromReview, outstandingFindings, readReview, reviewComment, reviewPrompt, type WorkItem } from "../../src/delivery";

const item: WorkItem = {
  id: "WO-0001",
  title: "Export CSV",
  objective: "Export the inventory as CSV.",
  criteria: [{ statement: "Archived items are not exported", verification: { kind: "test", detail: "export.test.ts" } }],
  outOfScope: [],
  risk: "low",
  likelyFiles: [],
  card: "",
};

const NO_TEST = "src/export.ts: no test for the empty case";
const QUOTES = "src/export.ts: a comma inside a name is not quoted";
const earlier = [NO_TEST, QUOTES];

const fixed = (finding: number) => ({ finding, status: "fixed", proof: "test/export.test.ts:14 covers it" });
const notFixed = (finding: number) => ({ finding, status: "not_fixed", proof: "src/export.ts:9 still joins with a bare comma" });
const answer = (verdict: string, entries: unknown[], findings: string[] = []) => ({ verdict, summary: "Checked the last round.", findings, earlier: entries });

describe("the reviewer's prompt", () => {
  it("is the order and the diff alone on a first round", () => {
    const prompt = reviewPrompt(item, "diff --git a/x b/x");

    expect(prompt).toBe(reviewPrompt(item, "diff --git a/x b/x", []));
    expect(prompt).not.toContain("last round");
    expect(prompt).not.toContain('"earlier"');
    expect(prompt.endsWith("## Out of scope\n- Nothing declared.\n## Diff of the pull request\ndiff --git a/x b/x")).toBe(true);
  });

  it("numbers the findings of the last round and asks what became of each, before the diff", () => {
    const prompt = reviewPrompt(item, "diff --git a/x b/x", earlier);

    expect(prompt).toContain(`## Your findings from the last round\n1. ${NO_TEST}\n2. ${QUOTES}\n`);
    expect(prompt).toContain("fixed only when the code shows it");
    expect(prompt.indexOf("## Your findings from the last round")).toBeLessThan(prompt.indexOf("## Diff of the pull request"));
  });
});

describe("the reviewer's answer on a later round", () => {
  it("names each earlier finding by its text, in the order they were asked", () => {
    expect(readReview(answer("changes_requested", [notFixed(2), fixed(1)]), earlier)).toMatchObject({
      ok: true,
      value: { verdict: "changes_requested", findings: [], earlier: [{ finding: NO_TEST, status: "fixed" }, { finding: QUOTES, status: "not_fixed" }] },
    });
  });

  it.each([
    ["skips an earlier finding", answer("changes_requested", [notFixed(2)]), "earlier finding 1 must be accounted for once, not 0 times"],
    ["leaves them all out", { verdict: "approved", summary: "Looks right.", findings: [] }, "earlier"],
    ["accounts for one twice", answer("changes_requested", [fixed(1), notFixed(2), fixed(2)]), "earlier finding 2 must be accounted for once, not 2 times"],
    ["answers for a finding it was never given", answer("approved", [fixed(1), fixed(2), fixed(3)]), "there is no earlier finding 3"],
    ["approves with one not fixed", answer("approved", [fixed(1), notFixed(2)]), "cannot approve while an earlier finding is not fixed"],
    ["asks for changes with everything fixed and nothing new", answer("changes_requested", [fixed(1), fixed(2)]), "changes_requested needs at least one finding"],
  ])("is refused when it %s", (_case, given, reason) => {
    expect(readReview(given, earlier)).toMatchObject({ ok: false, error: expect.stringContaining(reason) });
  });

  it("approves when every earlier finding is fixed", () => {
    expect(readReview(answer("approved", [fixed(1), fixed(2)]), earlier)).toMatchObject({ ok: true, value: { verdict: "approved" } });
  });

  it("drops from the new findings one that repeats an earlier finding still open", () => {
    const review = readReview(answer("changes_requested", [fixed(1), notFixed(2)], [QUOTES, "src/export.ts: the header row is missing"]), earlier);

    expect(review).toMatchObject({ ok: true, value: { findings: ["src/export.ts: the header row is missing"] } });
  });

  it("asks nothing about earlier findings on a first round", () => {
    const first = { verdict: "changes_requested", summary: "No test.", findings: [NO_TEST] };

    expect(readReview(first)).toEqual({ ok: true, value: first });
    expect(readReview({ ...first, findings: [] })).toMatchObject({ ok: false, error: expect.stringContaining("at least one finding") });
  });
});

describe("what a review leaves behind", () => {
  const second = { verdict: "changes_requested" as const, summary: "One is left.", findings: ["src/export.ts: the header row is missing"], earlier: [{ finding: NO_TEST, status: "fixed" as const, proof: "test/export.test.ts:14" }, { finding: QUOTES, status: "not_fixed" as const, proof: "src/export.ts:9 joins with a bare comma" }] };

  it("tells the worker what is still not fixed, with what is missing, then what is new", () => {
    expect(followUpFromReview(second)).toBe(
      `The independent reviewer asked for changes. Address each point, or say in your report why it does not apply:\n- ${QUOTES} (still not fixed: src/export.ts:9 joins with a bare comma)\n- src/export.ts: the header row is missing`,
    );
    expect(followUpFromReview(second)).not.toContain(NO_TEST);
  });

  it("marks each earlier finding in the pull request comment", () => {
    expect(reviewComment(second, 2)).toBe(
      [
        "**Independent review, round 2: changes requested**",
        "",
        "One is left.",
        "",
        "Findings of the last round:",
        `- **Fixed:** ${NO_TEST} (test/export.test.ts:14)`,
        `- **Not fixed:** ${QUOTES} (src/export.ts:9 joins with a bare comma)`,
        "",
        "New in this round:",
        "- src/export.ts: the header row is missing",
      ].join("\n"),
    );
  });

  it("leaves the next round the findings still open and the new ones, and nothing after an approval", () => {
    expect(outstandingFindings(second)).toEqual([QUOTES, "src/export.ts: the header row is missing"]);
    expect(outstandingFindings({ verdict: "approved", findings: ["src/export.ts: a name could be clearer"] })).toEqual([]);
  });

  it("writes a first round's comment and follow-up as it always did", () => {
    const first = { verdict: "changes_requested" as const, summary: "No test.", findings: [NO_TEST] };

    expect(reviewComment(first, 1)).toBe(`**Independent review, round 1: changes requested**\n\nNo test.\n\n- ${NO_TEST}`);
    expect(followUpFromReview(first)).toBe(`The independent reviewer asked for changes. Address each point, or say in your report why it does not apply:\n- ${NO_TEST}`);
  });
});
