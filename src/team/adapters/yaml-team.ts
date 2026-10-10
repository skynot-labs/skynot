import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { err, ok, type Result } from "../../kernel";
import { TeamFileSchema, type Advisor, type Team, type TeamFile } from "../domain";

export function parseTeamFile(source: string): Result<TeamFile, string> {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    return err(`team.yaml is not valid YAML: ${(error as Error).message}`);
  }

  const parsed = TeamFileSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    return err(`team.yaml is invalid: ${detail}`);
  }
  return ok(parsed.data);
}

export async function loadTeam(filePath: string): Promise<Result<Team, string>> {
  const file = parseTeamFile(await readFile(filePath, "utf8"));
  if (!file.ok) return file;

  const advisors: Record<string, Advisor> = {};
  for (const [name, advisor] of Object.entries(file.value.advisors)) {
    const soul = await readSoul(resolve(dirname(filePath), advisor.soul));
    if (!soul.ok) return err(`team.yaml: the soul of "${name}" (${advisor.soul}) ${soul.error}`);
    advisors[name] = { ...advisor, soul: soul.value };
  }
  return ok({ ...file.value, advisors });
}

async function readSoul(path: string): Promise<Result<string, string>> {
  let text: string;
  try {
    text = (await readFile(path, "utf8")).trim();
  } catch (error) {
    return err(`could not be read: ${(error as Error).message}`);
  }
  return text ? ok(text) : err("is empty");
}
