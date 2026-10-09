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

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

export function checkArchitecture(files: SourceFile[]): Violation[] {
  return files.flatMap((file) => violationsIn(file));
}

function violationsIn(file: SourceFile): Violation[] {
  const from = locate(file.path);
  if (!from) return [];

  const violations: Violation[] = [];
  for (const match of file.content.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1]!;
    if (!specifier.startsWith(".")) continue;

    const target = locate(path.posix.normalize(path.posix.join(path.posix.dirname(file.path), specifier)));
    const reason = target ? forbiddenReason(from, target) : null;
    if (reason) violations.push({ file: file.path, imports: specifier, reason });
  }
  return violations;
}

function forbiddenReason(from: Location, to: Location): string | null {
  if (to.context === "kernel") return null;
  if (from.context === "kernel") return "the kernel must not import a context";
  if (from.context !== to.context) return "contexts must not import each other's internals";
  if (from.layer === "domain" && to.layer !== "domain") return "the domain must not import application or adapters";
  if (from.layer === "application" && to.layer === "adapters") return "application must not import adapters";
  return null;
}

function locate(filePath: string): Location | null {
  const [root, context, layer] = filePath.split("/");
  if (root !== "src" || !context) return null;
  if (context === "kernel") return { context, layer: null };
  const known: Layer[] = ["domain", "application", "adapters"];
  return { context, layer: known.find((candidate) => candidate === layer) ?? null };
}
