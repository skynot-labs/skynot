export interface WorkItem {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly context?: string;
  readonly approach?: readonly string[];
  readonly criteria: ReadonlyArray<{ statement: string; verification: { kind: string; detail: string } }>;
  readonly outOfScope: readonly string[];
  readonly risk: string;
  readonly likelyFiles: readonly string[];
  readonly card: string;
  readonly answers?: readonly string[];
  readonly ticket?: number | null;
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
    ...(item.context ? ["## Context", item.context, ""] : []),
    ...(item.approach?.length ? ["## Approach", ...item.approach.map((step, index) => `${index + 1}. ${step}`), ""] : []),
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
    ...(item.ticket ? [`<sub>Taken from ticket #${item.ticket}.</sub>`, ""] : []),
    `<sub>Work order ${item.id}, written by the Manager and signed by the director.</sub>`,
  ].join("\n");
}

export function pullRequestBody(item: WorkItem, issue: number, report: string): string {
  return [
    `Closes #${issue}`,
    ...(item.ticket ? [`Closes #${item.ticket}`] : []),
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

export const QUESTION_MARK = "QUESTION:";
export const MAX_QUESTION = 300;

// The worker may stop to ask the director; the last line of its report that starts with the mark is the question.
export function askedQuestion(report: string): string | null {
  const line = report.split("\n").map((entry) => entry.trim()).findLast((entry) => entry.startsWith(QUESTION_MARK));
  const question = line?.slice(QUESTION_MARK.length).trim().slice(0, MAX_QUESTION);
  return question && question.length >= 3 ? question : null;
}

export interface WorkerRules {
  protectedPaths: readonly string[];
  verifyCommands: readonly string[];
}

// What every order's prompt carries whatever the order is.
export function workerStandingRules(rules: WorkerRules): string {
  return [
    "Rules:",
    "- Read AGENTS.md first and follow it.",
    "- Add or adjust tests for the new behavior. Never weaken, skip or delete an existing test.",
    `- Run these yourself until they pass, each exactly as written, one per call: ${rules.verifyCommands.join(", ")}. No other command is allowed, and the service runs them again after you: a denied command is never a reason to stop or to ask.`,
    `- Do not touch: ${rules.protectedPaths.join(", ")}.`,
    "- Do not commit or push; the service does that.",
    `- If you cannot go on without a decision about the product that only the director can take, and the repository does not answer it, do not guess and do not change anything: end your report with one line, \`${QUESTION_MARK} <the question, at most ${MAX_QUESTION} characters>\`.`,
  ].join("\n");
}

export function workerPrompt(item: WorkItem, issue: number, rules: WorkerRules, failure?: string, followUp?: string): string {
  const criteria = item.criteria
    .map((criterion) => `- ${criterion.statement} (verify, ${criterion.verification.kind}: ${criterion.verification.detail})`)
    .join("\n");
  const outOfScope = item.outOfScope.map((entry) => `- ${entry}`).join("\n") || "- Nothing declared.";

  const parts = [
    `You are a developer in a small shop. Implement work order ${item.id} (issue #${issue}) in this repository.`,
    `Objective:\n${item.objective}`,
    ...(item.context ? [`Context:\n${item.context}`] : []),
    ...(item.approach?.length ? [`Approach agreed before the order was signed. Follow it unless the code proves it wrong, and say so in your report if you depart from it:\n${item.approach.map((step, index) => `${index + 1}. ${step}`).join("\n")}`] : []),
    `Acceptance criteria. Each one needs evidence:\n${criteria}`,
    `Out of scope:\n${outOfScope}`,
    `Likely files: ${item.likelyFiles.join(", ") || "not identified"}`,
    workerStandingRules(rules),
    "Finish with a short report: for each acceptance criterion, the evidence (a test name, or a command and its result).",
  ];
  if (item.answers?.length) {
    parts.splice(1, 0, `The director already answered your questions. Follow these answers:\n${item.answers.map((answer) => `- ${answer}`).join("\n")}`);
  }
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
