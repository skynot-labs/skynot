import type { DeliveryRules } from "../delivery";
import {
  checkBranch,
  checkLabel,
  protectedPathsTouched,
  repoPolicy,
  type ActionBudget,
  type Policy,
  type PolicyViolation,
} from "../governance";
import { err, ok, type Result } from "../kernel";

const asMessage = <T>(result: Result<T, PolicyViolation>): Result<T, string> => (result.ok ? result : err(result.error.message));

export function createDeliveryRules(policy: Policy, budget: ActionBudget): DeliveryRules {
  return {
    maxRounds: policy.limits.max_rounds,
    workerTimeoutMs: policy.run_budget.timeout_seconds * 1000,
    workerMaxUsd: policy.run_budget.max_usd,

    repo(name) {
      const found = asMessage(repoPolicy(policy, name));
      if (!found.ok) return found;
      const { base_branch, setup_command, verify_commands, protected_paths } = found.value;
      return ok({ baseBranch: base_branch, setupCommand: setup_command, verifyCommands: verify_commands, protectedPaths: protected_paths });
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
      const found = repoPolicy(policy, repoName);
      return found.ok ? protectedPathsTouched(found.value, paths) : [...paths];
    },

    async spend(orderId) {
      return asMessage(await budget.spend(orderId));
    },
  };
}
