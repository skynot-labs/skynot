import path from "node:path";
import { protectedPathsTouched } from "./guard";

export const DEFAULT_MAX_CHANGED_LINES = 300;

export interface AutoMergeRule {
  readonly maxChangedLines: number;
  // Paths, written like protected paths, the shop never merges on its own.
  readonly never: readonly string[];
}

export interface MergeFacts {
  readonly review: { readonly verdict: string; readonly diffOnly: boolean };
  readonly risk: string;
  readonly verifyCommands: readonly string[];
  readonly upToDate: boolean;
  readonly conflicts: boolean;
  readonly diff: string;
  readonly protectedPaths: readonly string[];
}

// Names that mean money, accounts or the shape of stored data; matching a folder or file name by its start holds more than it lets through.
const SENSITIVE = ["auth", "login", "session", "password", "payment", "billing", "checkout", "migration", "schema"];
const CHECKS_NOTHING = new Set(["true", ":"]);

// null when the order may be merged; otherwise why it waits for the director.
export function holdReason(rule: AutoMergeRule, facts: MergeFacts): string | null {
  if (facts.review.verdict !== "approved") return "the reviewer did not approve it";
  if (facts.review.diffOnly) return "the reviewer approved it from the diff alone, without the repository";
  if (facts.risk !== "low") return `its risk is ${facts.risk}`;
  if (facts.verifyCommands.every((command) => CHECKS_NOTHING.has(command.trim()))) return "the project's verify commands check nothing yet";
  if (facts.conflicts) return "it conflicts with the base branch";
  if (!facts.upToDate) return "it was not built on the current base branch";
  const changed = changedLines(facts.diff);
  if (changed > rule.maxChangedLines) return `it changes ${changed} lines, more than the ${rule.maxChangedLines} allowed`;
  const files = changedFiles(facts.diff);
  const guarded = protectedPathsTouched({ protected_paths: [...facts.protectedPaths, ...rule.never] }, files);
  if (guarded.length > 0) return `it touches ${guarded.join(", ")}, which the director merges`;
  const sensitive = files.filter(looksSensitive);
  if (sensitive.length > 0) return `it touches ${sensitive.join(", ")}, which looks like accounts, money or stored data`;
  return null;
}

export function changedLines(diff: string): number {
  return diff.split("\n").filter((line) => (line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))).length;
}

export function changedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (header) files.add(header[1]!).add(header[2]!);
  }
  return [...files];
}

function looksSensitive(file: string): boolean {
  return path.posix
    .normalize(file)
    .toLowerCase()
    .split("/")
    .some((segment) => SENSITIVE.some((word) => segment.startsWith(word)));
}
