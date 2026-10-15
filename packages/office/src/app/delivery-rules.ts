import type { DeliveryRules } from "../delivery";
import { checkBranch, checkLabel, protectedPathsTouched, type ActionBudget, type Policy, type PolicyViolation } from "../governance";
import { err, ok, type Result } from "../kernel";
import type { Project, ProjectCommands } from "../projects";

// Without --prefix, npm in a folder with no package.json installs into the nearest parent that has one: the office's own checkout.
const NPM_INSTALL = "npm install --no-audit --no-fund --prefix .";

const asMessage = <T>(result: Result<T, PolicyViolation>): Result<T, string> => (result.ok ? result : err(result.error.message));

// `signedCommands` holds what the director signed since the office started; after a restart project.yaml says the same.
export function createDeliveryRules(policy: Policy, budget: ActionBudget, projects: readonly Project[], signedCommands: ReadonlyMap<string, ProjectCommands> = new Map()): DeliveryRules {
  return {
    maxRounds: policy.limits.max_rounds,
    workerTimeoutMs: policy.run_budget.timeout_seconds * 1000,
    workerMaxUsd: policy.run_budget.max_usd,

    repo(name) {
      const project = projects.find((candidate) => candidate.repo === name);
      if (!project) return err(`repository "${name}" belongs to no project`);
      const commands = signedCommands.get(project.id) ?? project;
      return ok({ baseBranch: project.baseBranch, setupCommand: commands.setupCommand, installCommand: NPM_INSTALL, verifyCommands: commands.verifyCommands, protectedPaths: project.protectedPaths });
    },

    branchFor(orderId) {
      const branch = `${policy.branch_prefix}${orderId.toLowerCase()}`;
      const allowed = asMessage(checkBranch(policy, branch));
      return allowed.ok ? ok(branch) : allowed;
    },

    triggerLabel() {
      const allowed = asMessage(checkLabel(policy, policy.labels.trigger));
      return allowed.ok ? ok(policy.labels.trigger) : allowed;
    },

    protectedTouched(repoName, paths) {
      const project = projects.find((candidate) => candidate.repo === repoName);
      return project ? protectedPathsTouched({ protected_paths: [...project.protectedPaths] }, paths) : [...paths];
    },

    async spend(orderId) {
      return asMessage(await budget.spend(orderId));
    },
  };
}
