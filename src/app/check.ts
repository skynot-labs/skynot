import { ClaudeEngine, CodexEngine } from "../execution";
import { exec } from "../kernel/process";
import { readPolicy, readTeam } from "./config";
import { readProjects } from "./projects";
import { checkReadiness, engineUsage } from "./readiness";

const policy = await readPolicy(false);
const [project] = await readProjects(policy);
const team = await readTeam(false, project!.id);

const findings = await checkReadiness({
  exec,
  engines: { claude: new ClaudeEngine(), codex: new CodexEngine() },
  usage: engineUsage(team),
  repo: project!.repo,
  baseBranch: project!.baseBranch,
  dataDir: process.env.SKYNOT_DATA ?? "data/shop",
});

const MARK = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;
for (const finding of findings) {
  console.log(`${MARK[finding.level]}  ${finding.check}: ${finding.detail}`);
  if (finding.fix) console.log(`      -> ${finding.fix}`);
}
process.exit(findings.some((finding) => finding.level === "fail") ? 1 : 0);
