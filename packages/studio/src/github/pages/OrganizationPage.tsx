import { pageHref, publicUrls, assetRoot, type PublicPage } from "../links";
import identity from "../site.json";
import { Arrow, Eyebrow, SectionTitle } from "../components";

export function OrganizationPage({ page }: { page: PublicPage }) {
  const root = assetRoot(page);
  return (
    <>
      <section class="gh-identity-hero">
        <div>
          <Eyebrow>THE LAB</Eyebrow>
          <h1>
            skynot
            <span class="gh-labs">
              / labs<span class="gh-period">.</span>
            </span>
          </h1>
          <p>{identity.organizationAbout}</p>
          <div class="gh-actions">
            <a class="gh-button" href={publicUrls.organization}>
              Profile on GitHub <Arrow />
            </a>
            <a class="gh-text-link" href="#here">
              What is here <Arrow />
            </a>
          </div>
        </div>
        <div class="gh-knot-art">
          <img
            src={`${root}brand/skynot-mark-trace.svg`}
            alt="The Skynot mark: one continuous stroke"
          />
          <span>{identity.organizationTagline.toUpperCase()}</span>
        </div>
      </section>
      <section class="gh-section">
        <SectionTitle
          label="WHERE THIS STANDS"
          title="I don't have this figured out."
        >
          {identity.organizationStatus} I'm{" "}
          <a href={identity.author.github}>{identity.author.name}</a>, and I
          write about what I learn, in Spanish, at{" "}
          <a href={identity.author.blog}>notdefined.dev</a>.
        </SectionTitle>
      </section>
      <section class="gh-section" id="here">
        <SectionTitle label="WHAT IS HERE" title="One project so far.">
          More will come. I don't know what yet.
        </SectionTitle>
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
              The GitHub App Skynot uses to open issues, branches and pull
              requests.
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
