import "./env-file";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ClaudeEngine, CodexEngine, type EngineName } from "../execution";
import { parseTeamFile } from "../team";
import { teamPath } from "./config";
import { CASES } from "./evals/cases";
import { casesBelow, formatCase, formatTotal, runTimes, type CaseReport } from "./evals/harness";
import { writeSeededRepo } from "./evals/seeded-repo";
import { MANAGER_TIMEOUT_MS } from "./shop";

const { values } = parseArgs({ options: { case: { type: "string" }, runs: { type: "string" }, min: { type: "string" }, engine: { type: "string" }, model: { type: "string" }, "max-usd": { type: "string" } } });

function positive(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`--${name} takes a whole number from 1, not "${value}"`);
  return number;
}

async function managerOfTeam(): Promise<{ engine: EngineName; model?: string | undefined }> {
  if (!existsSync(teamPath)) return { engine: "claude" };
  const team = parseTeamFile(await readFile(teamPath, "utf8"));
  if (!team.ok) throw new Error(team.error);
  return team.value.roles.manager;
}

const runs = positive("runs", values.runs, 3);
const min = positive("min", values.min, runs);
// Per call to the engine, so a case that goes wrong cannot spend without limit.
const maxUsd = Number(values["max-usd"] ?? 0.5);
if (!(maxUsd > 0)) throw new Error(`--max-usd takes an amount above 0, not "${values["max-usd"]}"`);
const cases = values.case ? CASES.filter((evalCase) => evalCase.name === values.case) : CASES;
if (cases.length === 0) throw new Error(`no case "${values.case}"; there are: ${CASES.map((evalCase) => evalCase.name).join(", ")}`);
if (values.engine !== undefined && values.engine !== "claude" && values.engine !== "codex") throw new Error(`--engine is claude or codex, not "${values.engine}"`);

const configured = await managerOfTeam();
const engine = values.engine ?? configured.engine;
// A model named for one engine means nothing to the other.
const model = values.model ?? (engine === configured.engine ? configured.model : undefined);

const repoDir = await mkdtemp(join(tmpdir(), "skynot-evals-"));
const reports: CaseReport[] = [];
try {
  await writeSeededRepo(repoDir);
  console.log(`The Manager's prompt on ${engine}, ${model ?? "the CLI's default model"}: ${cases.length} case(s), ${runs} run(s) each, at most ${maxUsd.toFixed(2)} per call. This spends quota.\n`);
  for (const evalCase of cases) {
    const report = await runTimes(evalCase, { engines: { claude: new ClaudeEngine(), codex: new CodexEngine() }, engine, repoDir, timeoutMs: MANAGER_TIMEOUT_MS, maxUsd, ...(model && { model }) }, runs);
    reports.push(report);
    console.log(formatCase(report));
  }
} finally {
  await rm(repoDir, { recursive: true, force: true });
}

console.log(`\n${formatTotal(reports)}`);
const below = casesBelow(reports, min);
if (below.length > 0) {
  console.log(`below ${min} of ${runs}: ${below.join(", ")}`);
  process.exitCode = 1;
}
