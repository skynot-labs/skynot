import path from "node:path";
import { err, ok, type Result } from "../../kernel";
import type { Policy, RepoPolicy } from "./policy";

export interface PolicyViolation {
  readonly kind: "repo_not_allowed" | "branch_outside_prefix" | "label_outside_prefix" | "action_limit_reached";
  readonly message: string;
}

export function repoPolicy(policy: Policy, repoName: string): Result<RepoPolicy, PolicyViolation> {
  const repo = policy.repos.find((candidate) => candidate.name === repoName);
  return repo ? ok(repo) : err({ kind: "repo_not_allowed", message: `${repoName} is not in policy.yaml` });
}

export function checkBranch(policy: Policy, branch: string): Result<void, PolicyViolation> {
  return branch.startsWith(policy.branch_prefix)
    ? ok(undefined)
    : err({ kind: "branch_outside_prefix", message: `branch "${branch}" is outside "${policy.branch_prefix}"` });
}

export function checkLabel(policy: Policy, label: string): Result<void, PolicyViolation> {
  return label.startsWith(policy.labels.prefix)
    ? ok(undefined)
    : err({ kind: "label_outside_prefix", message: `label "${label}" is outside "${policy.labels.prefix}"` });
}

export function protectedPathsTouched(repo: RepoPolicy, changedPaths: readonly string[]): string[] {
  const rules = repo.protected_paths.map((rule) => rule.toLowerCase());
  return changedPaths.filter((changed) => {
    const normalized = path.posix.normalize(changed).replace(/^\.\//, "").toLowerCase();
    return escapesRepo(normalized) || rules.some((rule) => matches(rule, normalized));
  });
}

function escapesRepo(normalized: string): boolean {
  return normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/");
}

function matches(rule: string, normalized: string): boolean {
  if (rule.endsWith("*")) return normalized.startsWith(rule.slice(0, -1));
  if (rule.endsWith("/")) return normalized.startsWith(rule);
  return normalized === rule;
}
