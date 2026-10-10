import { ClaudeEngine, CodexEngine } from "../execution";
import { githubExec } from "./github";
import { readPolicy, readTeam } from "./config";
import { readProjects } from "./projects";
import { checkShopReadiness } from "./readiness";

const policy = await readPolicy(false);
const projects = await readProjects(policy);
const teams = await Promise.all(projects.map(async (project) => ({ project, team: await readTeam(false, project.id) })));

const github = await githubExec();
console.log(`GitHub: acting as ${github.identity}`);
const findings = await checkShopReadiness({
  exec: github.exec,
  engines: { claude: new ClaudeEngine(), codex: new CodexEngine() },
  teams,
  dataDir: process.env.SKYNOT_DATA ?? "data/shop",
});

const MARK = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;
for (const finding of findings) {
  console.log(`${MARK[finding.level]}  ${finding.check}: ${finding.detail}`);
  if (finding.fix) console.log(`      -> ${finding.fix}`);
}
process.exit(findings.some((finding) => finding.level === "fail") ? 1 : 0);
