import { pageHref, publicUrls, assetRoot, type PublicPage } from "../links";
import identity from "../site.json";
import {
  Arrow,
  Eyebrow,
  SectionTitle,
  Principles,
  CopyButton,
  Download,
} from "../components";

export function OrganizationPage({
  page,
  copied,
}: {
  page: PublicPage;
  copied: (message: string) => void;
}) {
  const root = assetRoot(page);
  return (
    <>
      <section class="gh-identity-hero">
        <div>
          <Eyebrow>THE ORGANIZATION</Eyebrow>
          <h1>
            skynot
            <span class="gh-labs">
              / labs<span class="gh-period">.</span>
            </span>
          </h1>
          <p>
            {identity.organizationDescription} This is where the dev shop, its
            tools and its identity take shape.
          </p>
          <div class="gh-actions">
            <a class="gh-button" href={publicUrls.organization}>
              Profile on GitHub <Arrow />
            </a>
            <a class="gh-text-link" href="#profile">
              Set up the profile <Arrow />
            </a>
          </div>
        </div>
        <div class="gh-knot-art">
          <img
            src={`${root}brand/skynot-mark-trace.svg`}
            alt="The Skynot knot: one continuous stroke"
          />
          <span>ONE LINE. MANY CONNECTIONS.</span>
        </div>
      </section>
      <section class="gh-section">
        <SectionTitle
          label="HOW WE WORK"
          title="Tools that follow your judgment."
        />
        <Principles />
      </section>
      <section class="gh-section gh-profile-grid" id="profile">
        <div>
          <SectionTitle
            label="THE ORGANIZATION PROFILE"
            title="A consistent first impression."
          >
            The same knot as the studio, a clear description and a README that
            says what we build.
          </SectionTitle>
          <Download root={root} file="organization/profile/README.md">
            Profile README
          </Download>
          <Download root={root} file="organization/avatar.png">
            Organization avatar · PNG
          </Download>
          <p class="gh-footnote">
            The README is written for the public repository{" "}
            <code>{identity.organization}/.github</code>, at{" "}
            <code>profile/README.md</code>. The guide has the steps to place it.
          </p>
        </div>
        <div class="gh-profile-preview">
          <div class="gh-preview-label">CONTENT PREVIEW</div>
          <div class="gh-profile-heading">
            <img
              src={`${root}github-kit/organization/avatar.svg`}
              alt={`${identity.organization} avatar`}
            />
            <div>
              <h3>{identity.organization}</h3>
              <span>A human-directed software lab.</span>
            </div>
          </div>
          <h4>We build tools for deliberate software delivery.</h4>
          <p>
            Skynot is our agent dev shop: a Manager coordinates a team per
            project, and the director approves work and reviews deliveries.
          </p>
          <div class="gh-rule" />
          <span class="gh-eyebrow">CURRENT PROJECT</span>
          <a class="gh-repo-preview" href={pageHref(page, "project")}>
            <b>↗ skynot</b>
            <span>An agent dev shop, built with Node.js.</span>
            <small>IN DEVELOPMENT</small>
          </a>
        </div>
      </section>
      <section class="gh-section">
        <SectionTitle
          label="IDENTITY FOR GITHUB"
          title="The same brand, a different job each."
        />
        <div class="gh-asset-grid">
          <article>
            <img
              src={`${root}github-kit/organization/avatar.svg`}
              alt="The knot on a mint background"
            />
            <h3>Organization</h3>
            <p>Mint for the lab.</p>
            <Download root={root} file="organization/avatar.png">
              PNG · 512 × 512
            </Download>
          </article>
          <article>
            <img
              src={`${root}github-kit/app/badge.svg`}
              alt="The knot on a lavender background"
            />
            <h3>GitHub App</h3>
            <p>Lavender for the agent that connects.</p>
            <Download root={root} file="app/badge.png">
              PNG · 200 × 200
            </Download>
          </article>
          <article class="gh-cover-asset">
            <img
              src={`${root}github-kit/repository/social.svg`}
              alt="Skynot repository cover"
            />
            <h3>Repository</h3>
            <p>A shared cover for Skynot.</p>
            <Download root={root} file="repository/social.png">
              PNG · 1280 × 640
            </Download>
          </article>
        </div>
        <div class="gh-inline-copy">
          <span>{identity.organizationDescription}</span>
          <CopyButton
            text={identity.organizationDescription}
            copied={copied}
            label="Copy description"
          />
        </div>
      </section>
    </>
  );
}
