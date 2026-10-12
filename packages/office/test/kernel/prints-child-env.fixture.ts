import { exec } from "../../src/kernel/process";

const child = await exec("node", ["-p", "process.env.TSX_TSCONFIG_PATH ?? 'none'"]);
process.stdout.write(child.stdout);
