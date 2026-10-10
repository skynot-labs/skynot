import { publicUrls, assetRoot, type PublicPage } from "../links";
import identity from "../site.json";
import tokens from "../../design/tokens.json";
import { Eyebrow, SectionTitle, Download } from "../components";

export function GuidePage({ page }: { page: PublicPage }) {
  const root = assetRoot(page);
  const instructions = [
    {
      id: "organization",
      number: "01",
      title: `The ${identity.organization} profile`,
      text: "Create or reuse the organization's public .github repository. Put the README at profile/README.md and the avatar at profile/avatar.png. Then set the profile's description and picture.",
      file: "organization/profile/README.md",
      download: "Download README",
      code: `${identity.organization}/.github\n├── profile/README.md\n└── profile/avatar.png`,
    },
    {
      id: "app",
      number: "02",
      title: `The ${identity.app} listing`,
      text: "In the organization's settings, open Developer settings → GitHub Apps. Use the name, description, permissions and badge from the kit. The guide covers what the Skynot service reads to act as the App.",
      file: "app/SETUP.md",
      download: "Download setup guide",
      code: `GitHub App: ${identity.app}\nBadge: app/badge.png\nBackground: ${tokens.color.lavender}`,
    },
    {
      id: "pages",
      number: "03",
      title: "The Skynot repository site",
      text: "The repository carries the workflow at .github/workflows/pages.yml: it builds the static site and deploys it. Choose GitHub Actions as the source under Settings → Pages once; after that every push to main that touches the console publishes it.",
      file: "workflows/pages.yml",
      download: "Download workflow",
      code: "npm run build:github\n\nconsole/dist/github/          The built site\n.github/workflows/pages.yml  Deploy on push to main",
    },
    {
      id: "maintain",
      number: "04",
      title: "An identity you can maintain",
      text: "Names, descriptions and permissions have one source. The pages are presentation components; the illustrated studio reuses the console's renderer and talks to no service. Change the copy and regenerate the kit as the product evolves.",
      file: "README.md",
      download: "Download kit guide",
      code: "console/src/github/site.json       Identity and permissions\nconsole/src/github/                Pages and components\nconsole/src/design/                Tokens and knot\nconsole/scripts/export-github.mjs  Portable assets",
    },
  ];
  return (
    <>
      <section class="gh-guide-hero">
        <Eyebrow>GUIDES & RESOURCES</Eyebrow>
        <h1>
          From identity
          <br />
          <em>to GitHub.</em>
        </h1>
        <p>
          Four pages, one brand and files you can take to your repositories.
          Start with the profile, connect the App and publish the site when
          you are ready.
        </p>
        <a class="gh-button" href={`${root}github-kit/README.md`} download>
          Download the full guide <span aria-hidden="true">↓</span>
        </a>
      </section>
      <div class="gh-guide-layout">
        <aside>
          <span class="gh-eyebrow">IN THIS GUIDE</span>
          {instructions.map((item) => (
            <a href={`#${item.id}`}>
              <span>{item.number}</span>
              {item.title}
            </a>
          ))}
          <a href="#resources">
            <span>05</span>Brand assets
          </a>
        </aside>
        <div>
          {instructions.map((item) => (
            <section class="gh-guide-step" id={item.id}>
              <span class="gh-index">{item.number}</span>
              <h2>{item.title}</h2>
              <p>{item.text}</p>
              <pre>
                <code>{item.code}</code>
              </pre>
              <Download root={root} file={item.file}>
                {item.download}
              </Download>
              {item.id === "organization" && (
                <Download root={root} file="organization/profile/avatar.png">
                  Avatar for profile/
                </Download>
              )}
              {item.id === "app" && (
                <Download root={root} file="app/LISTING.md">
                  Listing fields
                </Download>
              )}
              {item.id === "pages" && (
                <p class="gh-footnote">
                  Site address: <code>{publicUrls.pages}</code>. GitHub Pages
                  serves static files only; the Skynot service runs elsewhere.
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
      <section class="gh-section" id="resources">
        <SectionTitle
          label="THE VISUAL KIT"
          title="A knot that travels with you."
        />
        <div class="gh-resource-list">
          <Download root={root} file="organization/avatar.png">
            Organization avatar · PNG 512
          </Download>
          <Download root={root} file="app/badge.png">
            App badge · PNG 200
          </Download>
          <Download root={root} file="repository/social.png">
            Repository cover · PNG 1280 × 640
          </Download>
          <a class="gh-download" href={`${root}brand/skynot-logo.svg`} download>
            Logo · SVG <span>↓</span>
          </a>
          <a
            class="gh-download"
            href={`${root}brand/skynot.tokens.json`}
            download
          >
            Tokens · JSON <span>↓</span>
          </a>
          <a
            class="gh-download"
            href={`${root}brand/skynot.tokens.css`}
            download
          >
            Tokens · CSS <span>↓</span>
          </a>
        </div>
        <p class="gh-footnote">
          The guides link to GitHub's official documentation.
        </p>
      </section>
    </>
  );
}
