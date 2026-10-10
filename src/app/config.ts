import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadPolicy, parsePolicy, type Policy } from "../governance";
import { loadTeam, type Team } from "../team";

export const policyPath = process.env.SKYNOT_POLICY ?? "policy.yaml";
export const teamPath = process.env.SKYNOT_TEAM ?? "team.yaml";

export async function readPolicy(mock: boolean): Promise<Policy> {
  if (existsSync(policyPath)) {
    const loaded = await loadPolicy(policyPath);
    if (!loaded.ok) throw new Error(loaded.error);
    return loaded.value;
  }
  if (!mock) throw new Error(`${policyPath} not found. Copy policy.example.yaml to policy.yaml and set your repository.`);

  const example = (await readFile("policy.example.yaml", "utf8")).replace("OWNER/REPO", "demo/todo");
  const parsed = parsePolicy(example);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export async function readTeam(mock: boolean): Promise<Team> {
  if (mock) return { version: 1, roles: { manager: { engine: "claude" }, developer: { engine: "codex" } }, advisors: {}, library: {} };
  if (!existsSync(teamPath)) throw new Error(`${teamPath} not found. Copy team.example.yaml to team.yaml.`);

  const loaded = await loadTeam(teamPath);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

