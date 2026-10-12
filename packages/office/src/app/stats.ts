import "./env-file";
import { join } from "node:path";
import { readPolicy } from "./config";
import { flowStats, formatFlowStats, readEventFile } from "./flow-stats";
import { readProjects } from "./projects";

const mock = process.env.SKYNOT_MOCK === "1";
const dataDir = process.env.SKYNOT_DATA ?? (mock ? "data/mock" : "data/shop");
const projects = await readProjects(await readPolicy(mock), mock);

const events = await readEventFile(join(dataDir, "events.jsonl")).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return [];
  throw error;
});
console.log(formatFlowStats(flowStats(events, projects[0]?.id)));
