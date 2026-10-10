import identity from "./site.json";

export type PublicPage = "project" | "organization" | "app" | "guide";
const paths: Record<PublicPage, string> = {
  project: "",
  organization: "organization/",
  app: "app/",
  guide: "guide/",
};
export const pages: { id: PublicPage; label: string }[] = [
  { id: "project", label: "Skynot" },
  { id: "organization", label: "Organization" },
  { id: "app", label: "GitHub App" },
  { id: "guide", label: "Guides and resources" },
];
export const publicUrls = {
  organization: `https://github.com/${identity.organization}`,
  repository: `https://github.com/${identity.organization}/${identity.repository}`,
  pages: `https://${identity.organization}.github.io/${identity.repository}/`,
  app: `https://github.com/apps/${identity.app}`,
};
// Each page has its own index.html. Relative links survive repository subpaths.
export const siteRoot = (page: PublicPage) =>
  page === "project" ? "./" : "../";
export const pageHref = (from: PublicPage, to: PublicPage) =>
  siteRoot(from) + paths[to];

export const assetRoot = (page: PublicPage) =>
  import.meta.env.DEV ? "/" : siteRoot(page);
