# The public site and the GitHub kit

Three static pages present Skynot outside the console: the project, the organization and the GitHub App's homepage. They are an about, written for a visitor: what each thing is and where it lives. They share the console's design tokens, knot and studio renderer, and talk to no service: no login, no API, no project data.

| Page | Served by the shop | On GitHub Pages |
| --- | --- | --- |
| Project | `/github/` | `https://skynot-labs.github.io/skynot/` |
| Organization | `/github/organization/` | `…/skynot/organization/` |
| App homepage | `/github/app/` | `…/skynot/app/` |

The Pages addresses follow from `organization` and `repository` in `console/src/github/site.json`; they exist once the repository lives under that organization and the workflow below has run.

## Build

```bash
npm run build:github    # the site alone, in console/dist/github/
npm run build:console   # the console, with the site under console/dist/github/
```

After `build:console` the shop serves the site at `/github/` next to the console. `npm run dev:console` serves it from source at the same path. `npm run github:export` alone regenerates the entry pages and the kit after a copy change.

Every page is a real `index.html` with relative links, scripts and assets, so the site works at a repository sub-path with no rewrite rule.

## Publish on GitHub Pages

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds the site and deploys `console/dist/github`. It runs on every push to `main` that touches the console, and can be started by hand from **Actions**.

Once, in the repository's **Settings → Pages**, choose **GitHub Actions** as the source.

A project site is served at `https://<owner>.github.io/<repository>/`; the organization's root address needs a repository named `<owner>.github.io` instead. See [custom workflows for Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## The kit

`console/public/github-kit/` holds what the maintainer takes to GitHub by hand; the pages do not link to it. Everything in it is generated except the PNG snapshots.

- **Organization profile.** Copy `organization/profile/README.md` to `profile/README.md` in the organization's public `.github` repository. Upload `organization/avatar.png` as the organization's picture. See [customizing an organization's profile](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile).
- **GitHub App.** `app/LISTING.md` has the registration fields and permissions, `app/badge.png` the logo. `app/SETUP.md` is the [App guide](github-app.md). GitHub renders the App's own listing page from the registration; the App page of this site is its homepage.
- **Repository.** `repository/social.png` goes in the repository's **Settings → Social preview**.
- **Workflow.** `workflows/pages.yml` is a copy of this repository's workflow.

## Where things live

- `console/src/github/site.json`: names, the one-line descriptions of the product and the organization, and the App's permissions. Every page, the profile and the listing take those lines from here. `organization` must match `console/src/design/logo.json`; the exporter checks it. When the service needs another permission, change it here and in the README.
- `console/src/github/pages/`: one component per page, with its copy. `StudioPreview.tsx` draws an invented team with the console's renderer.
- `console/scripts/export-github.mjs`: writes `console/github/**/index.html` and the kit from those sources. Do not edit its output.
- `console/vite.github.config.ts`: the site's own build.

### Regenerating the PNGs

The PNGs are checked-in snapshots of the generated SVGs, so a build needs no image library. The exporter keeps a fingerprint of each SVG and stops when one no longer matches its PNG. After changing the knot, a color or the social card:

```bash
npm run github:export -- --svg-only
npm install --no-save --package-lock=false sharp
node console/scripts/rasterize-github.mjs
npm prune
```

`SKYNOT_SHARP_MODULE` may point to a `sharp` installed elsewhere instead. Sizes: organization 512 × 512, App 200 × 200, social cover 1280 × 640.
