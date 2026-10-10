import { ClaudeEngine, CodexEngine } from "../execution";
import { exec } from "../kernel/process";
import { readPolicy, readTeam } from "./config";
import { checkReadiness, engineUsage } from "./readiness";

const policy = await readPolicy(false);
const team = await readTeam(false);
const repo = policy.repos[0]!;

const findings = await checkReadiness({
  exec,
  engines: { claude: new ClaudeEngine(), codex: new CodexEngine() },
  usage: engineUsage(team),
  repo: repo.name,
  baseBranch: repo.base_branch,
  dataDir: process.env.SKYNOT_DATA ?? "data/shop",
});

const MARK = { ok: "ok  ", warn: "WARN", fail: "FAIL" } as const;
for (const finding of findings) {
  console.log(`${MARK[finding.level]}  ${finding.check}: ${finding.detail}`);
  if (finding.fix) console.log(`      -> ${finding.fix}`);
}
process.exit(findings.some((finding) => finding.level === "fail") ? 1 : 0);
