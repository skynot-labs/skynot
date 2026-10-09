import { readFileSync } from "node:fs";
import { parsePolicy, type Policy } from "../../src/governance";

export function examplePolicy(overrides: Partial<Policy> = {}): Policy {
  const source = readFileSync("policy.example.yaml", "utf8").replace("OWNER/REPO", "acme/widgets");
  const parsed = parsePolicy(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return { ...parsed.value, ...overrides };
}
