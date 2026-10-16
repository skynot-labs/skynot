export { PolicySchema, type Policy, type RepoPolicy } from "./policy";
export { checkBranch, checkLabel, protectedPathsTouched, type PolicyViolation } from "./guard";
export { DEFAULT_MAX_CHANGED_LINES, changedFiles, changedLines, holdReason, type AutoMergeRule, type MergeFacts } from "./auto-merge";
