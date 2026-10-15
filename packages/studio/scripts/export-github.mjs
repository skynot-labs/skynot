import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = resolve(root, "../..");
const json = async (path) =>
  JSON.parse(await readFile(resolve(root, path), "utf8"));
const identity = await json("src/github/site.json");
const logo = await json("src/design/logo.json");
const tokens = await json("src/design/tokens.json");
if (identity.organization !== logo.organization)
  throw new Error("GitHub organization and logo namespace must match.");
for (const key of ["organization", "repository", "app"]) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(identity[key]))
    throw new Error(`Invalid GitHub ${key}`);
}
const homepage = `https://${identity.organization}.github.io/${identity.repository}/`;
const orgUrl = `https://github.com/${identity.organization}`;
const repoUrl = `${orgUrl}/${identity.repository}`;
const appUrl = `https://github.com/apps/${identity.app}`;
const kit = resolve(root, "public/github-kit");
async function output(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const entries = [
  {
    id: "project",
    path: "",
    title: `${identity.product} — ${identity.tagline}`,
    description: `${identity.description} A team per project, work orders you sign and deliveries you can review.`,
  },
  {
    id: "organization",
    path: "organization/",
    title: `${identity.organizationName} — ${identity.organizationTagline}`,
    description: identity.organizationDescription,
  },
  {
    id: "app",
    path: "app/",
    title: `${identity.app} — From the studio to the repository`,
    description: identity.appDescription,
  },
];
for (const page of entries) {
  const source = page.path
    ? "../../src/github/main.tsx"
    : "../src/github/main.tsx";
  await output(
    resolve(root, "github", page.path, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="${tokens.color.canvas}" />
    <title>${escape(page.title)}</title>
    <meta name="description" content="${escape(page.description)}" />
    <link rel="canonical" href="${homepage}${page.path}" />
    <link rel="icon" type="image/svg+xml" href="/brand/skynot-favicon.svg" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escape(page.title)}" />
    <meta property="og:description" content="${escape(page.description)}" />
    <meta property="og:url" content="${homepage}${page.path}" />
    <meta property="og:image" content="${homepage}github-kit/repository/social.png" />
    <meta property="og:image:width" content="1280" />
    <meta property="og:image:height" content="640" />
    <meta name="twitter:card" content="summary_large_image" />
  </head>
  <body data-page="${page.id}">
    <div id="app"></div>
    <noscript>This site needs JavaScript. <a href="${repoUrl}">Skynot on GitHub.</a></noscript>
    <script type="module" src="${source}"></script>
  </body>
</html>
`,
  );
}

const svg = (viewBox, title, content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title"><title id="title">${title}</title>${content}</svg>\n`;
const mark = `<path d="${logo.mark.path}" fill="none" stroke="${tokens.color.ink}" stroke-width="${logo.mark.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
const avatar = (color, title) =>
  svg(
    "0 0 512 512",
    title,
    `<rect width="512" height="512" fill="${color}"/><g transform="translate(64 64) scale(6)">${mark}</g>`,
  );
await output(
  resolve(kit, "organization/avatar.svg"),
  avatar(tokens.color.mint, `${identity.organization} avatar`),
);
await output(
  resolve(kit, "app/badge.svg"),
  avatar(tokens.color.lavender, `${identity.app} badge`),
);
const lockup = (
  await readFile(resolve(root, "public/brand/skynot-logo.svg"), "utf8")
)
  .replace(/^.*?<title[^>]*>.*?<\/title>/s, "")
  .replace(/<\/svg>\s*$/, "");
await output(
  resolve(kit, "repository/social.svg"),
  svg(
    "0 0 1280 640",
    "Skynot repository social cover",
    `<rect width="1280" height="640" fill="${tokens.color.canvas}"/><circle cx="1080" cy="180" r="270" fill="none" stroke="${tokens.color.border}"/><circle cx="1080" cy="180" r="210" fill="none" stroke="${tokens.color.border}"/><g transform="translate(845 22) scale(6)"><path d="${logo.mark.path}" fill="none" stroke="${tokens.color.mint}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g><g transform="translate(78 105) scale(1.52)">${lockup}</g><text x="90" y="346" fill="${tokens.color.text}" font-family="sans-serif" font-size="48">Your judgment.</text><text x="90" y="411" fill="${tokens.color.mint}" font-family="sans-serif" font-size="48">A team of agents.</text><path d="M90 491H1190" stroke="${tokens.color.border}"/><text x="90" y="554" fill="${tokens.color.muted}" font-family="monospace" font-size="18">${identity.organization} / ${identity.repository}</text><text x="1190" y="554" text-anchor="end" fill="${tokens.color.muted}" font-family="monospace" font-size="16">HUMAN-DIRECTED SOFTWARE</text>`,
  ),
);

await output(
  resolve(kit, "organization/profile/README.md"),
  `<!-- Generated by npm run github:export. Edit packages/studio/src/github/site.json and packages/studio/scripts/export-github.mjs. -->
# ${identity.organizationName}

${identity.organizationTagline} The agents here ask before they act.

${identity.organizationAbout}

I don't have this figured out. ${identity.organizationStatus}

## What is here

- [**Skynot**](${homepage}) is a dev shop of AI agents. You talk to a Manager, sign the work orders it proposes and review the pull requests its team opens. In development, MIT. [Source](${repoUrl}).
- [**${identity.app}**](${appUrl}) is the GitHub App Skynot uses to open those issues and pull requests.

More will come. I don't know what yet.

[${identity.author.name}](${identity.author.github}) · I write about what I learn, in Spanish, at [notdefined.dev](${identity.author.blog}).
`,
);
await output(
  resolve(kit, "app/LISTING.md"),
  `# ${identity.app} · GitHub App fields

GitHub renders the App's public page from these settings. This is not a Marketplace submission.

| Field | Value |
| --- | --- |
| Owner | ${identity.organization} |
| GitHub App name | ${identity.app} |
| Description | ${identity.appDescription} |
| Homepage | ${homepage}app/ |
| Public App URL | ${appUrl} |
| Webhook | Not active |
| Logo | badge.png · 200 × 200 |
| Badge background | ${tokens.color.lavender} |

## Permissions

| Scope | Resource | Access | Purpose |
| --- | --- | --- | --- |
${identity.permissions.map((p) => `| ${p.scope} | ${p.name}${p.optional ? " (optional)" : ""} | ${p.access} | ${p.reason} |`).join("\n")}

[SETUP.md](SETUP.md) covers registration, installation and what the service does with the App.
`,
);
const blob = `${repoUrl}/blob/main/`;
const doc = async (name, links) => {
  let text = await readFile(resolve(repository, "docs", name), "utf8");
  for (const [from, to] of Object.entries(links)) {
    if (!text.includes(`](${from}`))
      throw new Error(`${name} no longer links to ${from}`);
    text = text.replaceAll(`](${from}`, `](${to}`);
  }
  return text;
};
await output(
  resolve(kit, "app/SETUP.md"),
  await doc("github-app.md", {
    "configuration.md": `${blob}docs/configuration.md`,
    "../packages/studio/public/github-kit/app/LISTING.md": "LISTING.md",
  }),
);
await output(
  resolve(kit, "README.md"),
  await doc("github-kit.md", {
    "github-app.md": "app/SETUP.md",
    "../.github/workflows/site-pages.yml": "workflows/site-pages.yml",
  }),
);
await output(
  resolve(kit, "workflows/site-pages.yml"),
  await readFile(resolve(repository, ".github/workflows/site-pages.yml"), "utf8"),
);

// PNGs are optional during initial SVG generation, but must match for a build.
if (!process.argv.includes("--svg-only")) {
  const fingerprints = await json(
    "public/github-kit/raster-fingerprints.json",
  ).catch(() => ({}));
  for (const path of [
    "organization/avatar",
    "app/badge",
    "repository/social",
  ]) {
    const source = await readFile(resolve(kit, `${path}.svg`));
    await readFile(resolve(kit, `${path}.png`));
    const hash = createHash("sha256").update(source).digest("hex");
    if (fingerprints[path] !== hash)
      throw new Error(
        `Stale ${path}.png. Run github:export -- --svg-only, then packages/studio/scripts/rasterize-github.mjs (see docs/github-kit.md).`,
      );
  }
}
console.log(
  "GitHub kit exported: three page entries, profile, App fields, setup guide, workflow and brand assets.",
);
