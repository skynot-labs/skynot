import { useEffect, useRef, useState } from "preact/hooks";
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
import { GuidePage } from "./pages/GuidePage";

export function GitHubSite({ page }: { page: PublicPage }) {
  const root = assetRoot(page);
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copied = (message: string) => {
    clearTimeout(timer.current);
    setNotice(message);
    timer.current = setTimeout(() => setNotice(""), 5000);
  };
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
          <span>LOCAL PREVIEW · GITHUB KIT</span>
          <a href="/">
            Back to the studio <span aria-hidden="true">↗</span>
          </a>
        </div>
      )}
      <main id="content">
        {page === "project" ? (
          <ProjectPage page={page} />
        ) : page === "organization" ? (
          <OrganizationPage page={page} copied={copied} />
        ) : page === "app" ? (
          <GitHubAppPage page={page} copied={copied} />
        ) : (
          <GuidePage page={page} />
        )}
      </main>
      <footer class="gh-footer">
        <Brand tagline={false} assetBase={`${root}brand/`} />
        <p>
          Human-directed software.
          <br />
          <span>A {identity.organization} project · In development</span>
        </p>
        <div>
          <a href={pageHref(page, "guide")}>Guides and resources</a>
          <a href={publicUrls.repository}>
            Repository on GitHub <Arrow />
          </a>
        </div>
      </footer>
      <div
        class={`gh-notice ${notice ? "is-visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notice}
      </div>
    </div>
  );
}
