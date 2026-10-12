import "./env-file";
import { checkShop, findingLines } from "./shop-check";

const { identity, findings } = await checkShop();
console.log(`GitHub: acting as ${identity}`);
for (const line of findingLines(findings)) console.log(line);
process.exit(findings.some((finding) => finding.level === "fail") ? 1 : 0);
