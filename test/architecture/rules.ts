import path from "node:path";

export interface SourceFile {
  path: string;
  content: string;
}

export interface Violation {
  file: string;
  imports: string;
  reason: string;
}

type Layer = "domain" | "application" | "adapters";

interface Location {
  context: string;
  layer: Layer | null;
}

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["'`]([^"'`]+)["'`]/g;
const PROJECT_REGISTRY = /\b(?:Yaml)?ProjectRegistry\b/;
const OFFICE = "packages/office";
const OFFICE_SOURCE = `${OFFICE}/src`;
const STUDIO = "packages/studio";
const CONTRACT = "packages/contract";
const MAY_REGISTER_PROJECTS = (filePath: string) => filePath === `${OFFICE_SOURCE}/app/main.ts` || filePath.startsWith(`${OFFICE_SOURCE}/app/http/`);

export function checkArchitecture(files: SourceFile[]): Violation[] {
  return files.flatMap((file) => violationsIn(file));
}

function violationsIn(file: SourceFile): Violation[] {
  const from = locate(file.path);
  if (!from) return [];

  const violations: Violation[] = [];
  const registry = from.context === "app" && !MAY_REGISTER_PROJECTS(file.path) ? PROJECT_REGISTRY.exec(file.content)?.[0] : undefined;
  if (registry) violations.push({ file: file.path, imports: registry, reason: "only main and the HTTP layer may reach project registration" });
  for (const specifier of importsOf(file)) {
    const resolved = resolve(file.path, specifier);
    const target = resolved ? locate(resolved) : null;
    const reason = target ? forbiddenReason(from, target) : null;
    if (reason) violations.push({ file: file.path, imports: specifier, reason });
  }
  return violations;
}

export function checkBoundaries(files: SourceFile[]): Violation[] {
  return files.flatMap((file) =>
    importsOf(file).flatMap((specifier) => {
      const reason = crossingReason(file.path, specifier);
      return reason ? [{ file: file.path, imports: specifier, reason }] : [];
    }),
  );
}

function crossingReason(filePath: string, specifier: string): string | null {
  const target = resolve(filePath, specifier);
  if (within(STUDIO, filePath)) {
    return target && !within(STUDIO, target) && !within(CONTRACT, target) ? "the studio may import only itself and the contract" : null;
  }
  if (within(`${CONTRACT}/src`, filePath)) {
    const allowed = target ? within(CONTRACT, target) : specifier === "zod" || specifier.startsWith("zod/");
    return allowed ? null : "the contract may import only itself and zod";
  }
  if (within(OFFICE, filePath)) {
    const studio = target ? within(STUDIO, target) : specifier === "@skynot/studio" || specifier.startsWith("@skynot/studio/");
    return studio ? "the office must not import the studio" : null;
  }
  return null;
}

function importsOf(file: SourceFile): string[] {
  return [...file.content.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]!);
}

function resolve(filePath: string, specifier: string): string | null {
  return specifier.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier)) : null;
}

function within(dir: string, filePath: string): boolean {
  return filePath === dir || filePath.startsWith(`${dir}/`);
}

function forbiddenReason(from: Location, to: Location): string | null {
  if (to.context === "kernel") return null;
  if (from.context === "kernel") return "the kernel must not import a context";
  if (from.context === "app") return to.layer === null ? null : "the app layer may only import a context's public index";
  if (to.context === "app") return "contexts must not import the app layer";
  if (from.context !== to.context) return "contexts must not import each other's internals";
  if (from.layer === "domain" && to.layer !== "domain") return "the domain must not import application or adapters";
  if (from.layer === "application" && to.layer === "adapters") return "application must not import adapters";
  return null;
}

function locate(filePath: string): Location | null {
  if (!within(OFFICE_SOURCE, filePath)) return null;
  const [context, layer] = filePath.slice(OFFICE_SOURCE.length + 1).split("/");
  if (!context) return null;
  if (context === "kernel") return { context, layer: null };
  const known: Layer[] = ["domain", "application", "adapters"];
  return { context, layer: known.find((candidate) => candidate === layer) ?? null };
}
