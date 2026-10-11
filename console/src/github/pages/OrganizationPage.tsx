import { pageHref, publicUrls, assetRoot, type PublicPage } from "../links";
import identity from "../site.json";
import { Arrow, Eyebrow, SectionTitle, Principles } from "../components";

export function OrganizationPage({ page }: { page: PublicPage }) {
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
            {identity.organizationDescription} This is where Skynot, its tools
            and its identity take shape.
          </p>
          <div class="gh-actions">
            <a class="gh-button" href={publicUrls.organization}>
              Profile on GitHub <Arrow />
            </a>
            <a class="gh-text-link" href="#building">
              What we are building <Arrow />
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
      <section class="gh-section" id="building">
        <SectionTitle
          label="WHAT WE ARE BUILDING"
          title="One project so far."
        />
        <div class="gh-principles">
          <article>
            <span class="gh-index">01</span>
            <h3>Skynot</h3>
            <p>{identity.description} In development.</p>
            <a class="gh-text-link" href={pageHref(page, "project")}>
              The project <Arrow />
            </a>
          </article>
          <article>
            <span class="gh-index">02</span>
            <h3>{identity.app}</h3>
            <p>
              The GitHub App a Skynot service acts as when it opens issues,
              branches and pull requests.
            </p>
            <a class="gh-text-link" href={pageHref(page, "app")}>
              The GitHub App <Arrow />
            </a>
          </article>
          <article>
            <span class="gh-index">03</span>
            <h3>Source</h3>
            <p>Open source under the MIT license.</p>
            <a class="gh-text-link" href={publicUrls.repository}>
              Repository on GitHub <Arrow />
            </a>
          </article>
        </div>
      </section>
    </>
  );
}
