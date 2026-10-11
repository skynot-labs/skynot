import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/github-kit",
);
const modulePath = process.env.SKYNOT_SHARP_MODULE;
const { default: sharp } = await import(
  modulePath ? pathToFileURL(modulePath).href : "sharp"
).catch(() => {
  throw new Error(
    "PNG regeneration requires sharp, which is not a dependency. See docs/github-kit.md.",
  );
});
const sizes = {
  "organization/avatar": [512, 512],
  "app/badge": [200, 200],
  "repository/social": [1280, 640],
};
const fingerprints = {};
for (const [path, [width, height]] of Object.entries(sizes)) {
  const svg = await readFile(resolve(root, `${path}.svg`));
  await sharp(svg, { density: 144 })
    .resize(width, height)
    .png()
    .toFile(resolve(root, `${path}.png`));
  fingerprints[path] = createHash("sha256").update(svg).digest("hex");
}
await writeFile(
  resolve(root, "raster-fingerprints.json"),
  JSON.stringify(fingerprints, null, 2) + "\n",
);
console.log(
  "GitHub PNG snapshots regenerated with matching source fingerprints.",
);
