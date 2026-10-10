import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { err, ok, type Result } from "../../kernel";
import { TeamSchema, type Team } from "../domain";

export function parseTeam(source: string): Result<Team, string> {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    return err(`team.yaml is not valid YAML: ${(error as Error).message}`);
  }

  const parsed = TeamSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    return err(`team.yaml is invalid: ${detail}`);
  }
  return ok(parsed.data);
}

export async function loadTeam(filePath: string): Promise<Result<Team, string>> {
  return parseTeam(await readFile(filePath, "utf8"));
}
