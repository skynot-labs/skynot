import { ClaudeEngine, CodexEngine } from "../execution";
import { githubExec } from "./github";
import { readPolicy, readTeam } from "./config";
import { readProjects } from "./projects";
import { checkShopReadiness, type Finding } from "./readiness";

export async function checkShop(env: NodeJS.ProcessEnv = process.env): Promise<{ identity: string; findings: Finding[] }> {
  const policy = await readPolicy(false);
  const projects = await readProjects(policy);
  const teams = await Promise.all(projects.map(async (project) => ({ project, team: await readTeam(false, project.id) })));

  const github = await githubExec(env);
  const findings = await checkShopReadiness({
    exec: github.exec,
    execFor: github.execFor,
    engines: { claude: new ClaudeEngine(), codex: new CodexEngine() },
    teams,
    dataDir: env.SKYNOT_DATA ?? "data/shop",
  });
  return { identity: github.identity, findings };
}

const MARK = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;

export function findingLines(findings: readonly Finding[]): string[] {
  return findings.flatMap((finding) => [`${MARK[finding.level]}  ${finding.check}: ${finding.detail}`, ...(finding.fix ? [`      -> ${finding.fix}`] : [])]);
}
