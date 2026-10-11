import { publicUrls, assetRoot, type PublicPage } from "../links";
import identity from "../site.json";
import { Arrow, Eyebrow, SectionTitle } from "../components";

export function GitHubAppPage({ page }: { page: PublicPage }) {
  const root = assetRoot(page);
  return (
    <>
      <section class="gh-app-hero">
        <div>
          <Eyebrow>THE SKYNOT GITHUB APP</Eyebrow>
          <h1>
            From the studio
            <br />
            <em>to the repository.</em>
          </h1>
          <p>
            An identity for your agents' work. Skynot uses the App to read
            tickets, push branches and open pull requests in the repositories
            you select.
          </p>
          <div class="gh-actions">
            <a class="gh-button gh-lavender" href="#setup">
              How it connects <Arrow />
            </a>
            <a class="gh-text-link" href={publicUrls.app}>
              Listing on GitHub <Arrow />
            </a>
            <a class="gh-text-link" href={publicUrls.setupGuide}>
              Setup guide <Arrow />
            </a>
          </div>
          <p class="gh-footnote">
            Skynot is in development and self-hosted: the App is the identity
            of a service you run.
          </p>
        </div>
        <div class="gh-app-card">
          <span class="gh-preview-label">INTEGRATION IDENTITY</span>
          <img
            class="gh-app-avatar"
            src={`${root}github-kit/app/badge.svg`}
            alt={`${identity.app} badge`}
          />
          <h2>{identity.app}</h2>
          <p>{identity.appDescription}</p>
          <div class="gh-app-flow">
            <span>Studio</span>
            <span aria-hidden="true">↔</span>
            <b>GitHub</b>
          </div>
          <span class="gh-chip">You authorize the work</span>
        </div>
      </section>
      <section class="gh-section" id="setup">
        <SectionTitle
          label="ONE CONNECTION, THREE STEPS"
          title="Installing is the start."
        >
          The App identifies the service on GitHub. The Skynot service keeps
          running on your machine or your infrastructure.
        </SectionTitle>
        <div class="gh-principles">
          <article>
            <span class="gh-index">01</span>
            <h3>Select repositories</h3>
            <p>
              Install the App on the account or organization that owns each
              project's repository, and select those repositories.
            </p>
          </article>
          <article>
            <span class="gh-index">02</span>
            <h3>Configure your service</h3>
            <p>
              The operator gives the Skynot service the App ID and the path to
              its private key. It finds each account's installation itself.
            </p>
          </article>
          <article>
            <span class="gh-index">03</span>
            <h3>Direct from the studio</h3>
            <p>
              The Manager proposes orders; your signature lets them run.
              Installing the App starts no agent by itself.
            </p>
          </article>
        </div>
      </section>
      <section class="gh-section">
        <SectionTitle
          label="PERMISSIONS WITH A PURPOSE"
          title="Access for the work it does."
        >
          This is what the service needs today. Projects is optional and only
          reaches a board owned by an organization.
        </SectionTitle>
        <div class="gh-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Access</th>
                <th>What it is for</th>
              </tr>
            </thead>
            <tbody>
              {identity.permissions.map((permission) => (
                <tr>
                  <td>
                    <b>{permission.name}</b>
                    <small>
                      {permission.scope}
                      {permission.optional ? " · optional" : ""}
                    </small>
                  </td>
                  <td>{permission.access}</td>
                  <td>{permission.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="gh-footnote">
          The reviewing agent posts its verdict as a comment, not as a GitHub
          approval. Merging the pull request stays your decision.
        </p>
      </section>
    </>
  );
}
