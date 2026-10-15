// Stands in for `npm install [--save-dev] <names>`: records each name in package.json and leaves a module behind.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const field = args.includes("--save-dev") ? "devDependencies" : "dependencies";
const names = args.filter((arg) => !arg.startsWith("--"));
let manifest = {};
try {
  manifest = JSON.parse(readFileSync("package.json", "utf8"));
} catch {}
manifest[field] = { ...manifest[field] };
for (const name of names) {
  manifest[field][name] = "^1.0.0";
  mkdirSync(join("node_modules", name), { recursive: true });
  writeFileSync(join("node_modules", name, "index.js"), "export default 1;\n");
}
writeFileSync("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
