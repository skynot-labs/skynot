import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { err, ok, type Result } from "../../kernel";
import { PolicySchema, type Policy } from "../domain";

const PLACEHOLDER_REPO = "OWNER/REPO";

export function parsePolicy(source: string): Result<Policy, string> {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    return err(`policy.yaml is not valid YAML: ${(error as Error).message}`);
  }

  const parsed = PolicySchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    return err(`policy.yaml is invalid: ${detail}`);
  }
  if (parsed.data.repos.some((repo) => repo.name === PLACEHOLDER_REPO)) {
    return err(`policy.yaml still lists the placeholder ${PLACEHOLDER_REPO}`);
  }
  return ok(parsed.data);
}

export async function loadPolicy(filePath: string): Promise<Result<Policy, string>> {
  return parsePolicy(await readFile(filePath, "utf8"));
}
