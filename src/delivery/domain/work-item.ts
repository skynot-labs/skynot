export interface WorkItem {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly criteria: ReadonlyArray<{ statement: string; verification: { kind: string; detail: string } }>;
  readonly outOfScope: readonly string[];
  readonly risk: string;
  readonly likelyFiles: readonly string[];
  readonly card: string;
}

export interface FileChange {
  readonly path: string;
  readonly status: string;
}

export const issueTitle = (item: WorkItem): string => `${item.id} ${item.title}`;

export function issueBody(item: WorkItem): string {
  const criteria = item.criteria
    .map((criterion) => `- [ ] ${criterion.statement}\n  - Verify (${criterion.verification.kind}): ${criterion.verification.detail}`)
    .join("\n");
  const outOfScope = item.outOfScope.length ? item.outOfScope.map((entry) => `- ${entry}`).join("\n") : "- Nothing declared.";
  const files = item.likelyFiles.length ? item.likelyFiles.map((file) => `- \`${file}\``).join("\n") : "- Not identified.";

  return [
    "```",
    item.card,
    "```",
    "",
    "## Objective",
    item.objective,
    "",
    "## Acceptance criteria",
    criteria,
    "",
    "## Out of scope",
    outOfScope,
    "",
    "## Risk",
    item.risk,
    "",
    "## Likely files",
    files,
    "",
    `<sub>Work order ${item.id}, written by the Manager and signed by the director.</sub>`,
  ].join("\n");
}

export function pullRequestBody(item: WorkItem, issue: number, report: string): string {
  return [
    `Closes #${issue}`,
    "",
    "```",
    item.card,
    "```",
    "",
    "## Evidence",
    report || "No report.",
    "",
    `<sub>Implemented by a worker for work order ${item.id}. Verified by the service before this pull request was opened.</sub>`,
  ].join("\n");
}

export interface WorkerRules {
  protectedPaths: readonly string[];
  verifyCommands: readonly string[];
}

export function workerPrompt(item: WorkItem, issue: number, rules: WorkerRules, failure?: string, followUp?: string): string {
  const criteria = item.criteria
    .map((criterion) => `- ${criterion.statement} (verify, ${criterion.verification.kind}: ${criterion.verification.detail})`)
    .join("\n");
  const outOfScope = item.outOfScope.map((entry) => `- ${entry}`).join("\n") || "- Nothing declared.";

  const parts = [
    `You are a developer in a small shop. Implement work order ${item.id} (issue #${issue}) in this repository.`,
    `Objective:\n${item.objective}`,
    `Acceptance criteria. Each one needs evidence:\n${criteria}`,
    `Out of scope:\n${outOfScope}`,
    `Likely files: ${item.likelyFiles.join(", ") || "not identified"}`,
    [
      "Rules:",
      "- Read AGENTS.md first and follow it.",
      "- Add or adjust tests for the new behavior. Never weaken, skip or delete an existing test.",
      `- Run these yourself until they pass: ${rules.verifyCommands.join(", ")}.`,
      `- Do not touch: ${rules.protectedPaths.join(", ")}.`,
      "- Do not commit or push; the service does that.",
    ].join("\n"),
    "Finish with a short report: for each acceptance criterion, the evidence (a test name, or a command and its result).",
  ];
  if (followUp) {
    parts.splice(
      1,
      0,
      [
        "This is a follow-up on an open pull request. The branch already holds the work for this order, brought up to date with the base branch.",
        "Files containing conflict markers (<<<<<<<, =======, >>>>>>>) are unresolved merge conflicts: resolve each one keeping the intent of both sides, and leave no marker behind.",
        `The director asks:\n${followUp}`,
      ].join("\n"),
    );
  }
  if (failure) parts.push(`Your previous attempt failed verification. Output:\n${failure}\nFix it.`);
  return parts.join("\n\n");
}

const TEST_PATH = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./;

export function deletedTest(changes: readonly FileChange[]): string | undefined {
  return changes.find((change) => change.status.includes("D") && TEST_PATH.test(change.path))?.path;
}
