// "/" when an office serves the console, "./" when it is published as a static site under any folder.
const base = import.meta.env.BASE_URL;
const servedByAnOffice = base === "/";

export const paths = {
  studio: base,
  brand: `${base}brand/`,
  // A static host has no /design to fall back on, so there the page is asked for in the query.
  design: servedByAnOffice ? "/design" : `${base}?design`,
  // An office serves the public site inside the console; on Pages the studio sits one folder inside the site.
  github: servedByAnOffice ? "/github/" : "../",
};

export function isDesignPage({ pathname, search }: Pick<Location, "pathname" | "search">): boolean {
  return /^\/design\/?$/.test(pathname) || new URLSearchParams(search).has("design");
}
