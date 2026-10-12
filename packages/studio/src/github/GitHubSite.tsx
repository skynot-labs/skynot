import identity from "./site.json";
import { Brand } from "../design/Brand";
import { Arrow } from "./components";
import {
  pages,
  pageHref,
  publicUrls,
  assetRoot,
  type PublicPage,
} from "./links";
import { ProjectPage } from "./pages/ProjectPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { GitHubAppPage } from "./pages/GitHubAppPage";

export function GitHubSite({ page }: { page: PublicPage }) {
  const root = assetRoot(page);
  return (
    <div class={`gh-site gh-page-${page}`}>
      <a class="gh-skip" href="#content">
        Skip to content
      </a>
      <header class="gh-header">
        <a href={pageHref(page, "project")} aria-label="Skynot, home">
          <Brand tagline={false} assetBase={`${root}brand/`} />
        </a>
        <nav aria-label="Skynot pages">
          {pages.map((entry) => (
            <a
              href={pageHref(page, entry.id)}
              aria-current={entry.id === page ? "page" : undefined}
            >
              {entry.label}
            </a>
          ))}
        </nav>
        <a class="gh-header-github" href={publicUrls.organization}>
          {identity.organization} <Arrow />
        </a>
      </header>
      {import.meta.env.DEV && (
        <div class="gh-preview-bar">
          <span>LOCAL PREVIEW · PUBLIC SITE</span>
          <a href="/">
            Back to the studio <span aria-hidden="true">↗</span>
          </a>
        </div>
      )}
      <main id="content">
        {page === "project" ? (
          <ProjectPage page={page} />
        ) : page === "organization" ? (
          <OrganizationPage page={page} />
        ) : (
          <GitHubAppPage page={page} />
        )}
      </main>
      <footer class="gh-footer">
        <Brand tagline={false} assetBase={`${root}brand/`} />
        <p>
          Human-directed software.
          <br />
          <span>
            A {identity.organizationName} project · In development · MIT
          </span>
        </p>
        <div>
          <a href={publicUrls.app}>
            GitHub App <Arrow />
          </a>
          <a href={publicUrls.repository}>
            Repository on GitHub <Arrow />
          </a>
        </div>
      </footer>
    </div>
  );
}
