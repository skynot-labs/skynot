import { mkdir, readFile, readdir, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { isMap, isScalar, parse, parseDocument, stringify } from "yaml";
import { err, ok, type Result } from "../../kernel";
import { PROJECT_ID, ProjectFileSchema, toProject, type BriefingStore, type Project, type ProjectCatalog, type ProjectFile, type ProjectProfile, type ProjectRegistry } from "../domain";

const PLACEHOLDER_REPO = "OWNER/REPO";

const detailOf = (error: z.ZodError): string => error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");

export function parseProjectFile(id: string, source: string): Result<Project, string> {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    return err(`projects/${id}/project.yaml is not valid YAML: ${(error as Error).message}`);
  }
  const parsed = ProjectFileSchema.safeParse(raw);
  if (!parsed.success) return err(`projects/${id}/project.yaml is invalid: ${detailOf(parsed.error)}`);
  if (parsed.data.repo === PLACEHOLDER_REPO) return err(`projects/${id}/project.yaml still lists the placeholder ${PLACEHOLDER_REPO}`);
  return ok(toProject(id, parsed.data));
}

// One folder per project: <dir>/<id>/project.yaml, and optionally briefing.md next to it.
export class YamlProjectCatalog implements ProjectCatalog {
  constructor(private readonly dir: string) {}

  async list(): Promise<Project[]> {
    const entries = await readdir(this.dir, { withFileTypes: true }).catch(() => []);
    const projects: Project[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = await readFile(join(this.dir, entry.name, "project.yaml"), "utf8").catch(() => null);
      // a folder without project.yaml is something else that lives there, not a project
      if (source === null) continue;
      if (!PROJECT_ID.test(entry.name)) throw new Error(`${this.dir}/${entry.name}: a project folder is named in lowercase letters, digits and dashes`);
      const project = parseProjectFile(entry.name, source);
      if (!project.ok) throw new Error(project.error);
      projects.push(project.value);
    }
    return projects;
  }
}

const PROFILE_KEYS = ["name", "description"] as const;
type ProfileKey = (typeof PROFILE_KEYS)[number];

function scalarLine(key: ProfileKey, value: string): string {
  const plain = stringify(value, { lineWidth: 0 }).trimEnd();
  return `${key}: ${plain.includes("\n") ? stringify(value, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" }).trimEnd() : plain}`;
}

// Splices the source instead of re-rendering the document, which would reflow the director's lists and comments.
function withProfileKey(source: string, key: ProfileKey, value: string | null): Result<string, string> {
  const root = parseDocument(source).contents;
  if (!isMap(root) || root.flow) return err("project.yaml is not written as one key per line, so it has to be edited by hand");
  const pairOf = (name: string) => root.items.find((pair) => isScalar(pair.key) && pair.key.value === name);
  const rangeOf = (name: string) => {
    const pair = pairOf(name);
    if (!pair || !isScalar(pair.key) || !pair.key.range) return null;
    const [start, , keyEnd] = pair.key.range;
    const [, valueEnd, lineEnd] = isScalar(pair.value) && pair.value.range ? pair.value.range : [start, keyEnd, keyEnd];
    return { start, valueEnd, lineEnd };
  };
  const existing = rangeOf(key);
  if (existing) {
    if (value === null) return ok(source.slice(0, existing.start) + source.slice(existing.lineEnd));
    const replaced = source.slice(existing.start, existing.valueEnd);
    return ok(source.slice(0, existing.start) + scalarLine(key, value) + (replaced.endsWith("\n") ? "\n" : "") + source.slice(existing.valueEnd));
  }
  if (value === null) return ok(source);
  const at = (key === "description" ? rangeOf("name") : null)?.lineEnd ?? rangeOf("version")?.lineEnd ?? 0;
  const before = source.slice(0, at);
  return ok(`${before}${before === "" || before.endsWith("\n") ? "" : "\n"}${scalarLine(key, value)}\n${source.slice(at)}`);
}

export class YamlProjectRegistry implements ProjectRegistry {
  constructor(private readonly dir: string) {}

  async register(id: string, file: ProjectFile): Promise<Result<Project, string>> {
    if (!PROJECT_ID.test(id)) return err(`"${id}" cannot be a project id: use 2 to 40 lowercase letters, digits and dashes, starting with a letter.`);
    const parsed = ProjectFileSchema.safeParse(file);
    if (!parsed.success) return err(`The project is not valid: ${detailOf(parsed.error)}.`);
    const source = stringify(parsed.data, { lineWidth: 0 });
    const project = parseProjectFile(id, source);
    if (!project.ok) return project;
    const folder = join(this.dir, id);
    try {
      await mkdir(this.dir, { recursive: true });
      await mkdir(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return err(`${folder} already exists: choose another id.`);
      return err(`Could not create ${folder}: ${(error as Error).message}`);
    }
    try {
      await writeFile(join(folder, "project.yaml"), source, { flag: "wx" });
    } catch (error) {
      await rmdir(folder).catch(() => undefined);
      return err(`Could not write ${folder}/project.yaml: ${(error as Error).message}`);
    }
    return project;
  }

  async describe(id: string, profile: ProjectProfile): Promise<Result<Project, string>> {
    const file = join(this.dir, id, "project.yaml");
    const source = PROJECT_ID.test(id) ? await readFile(file, "utf8").catch(() => null) : null;
    if (source === null) return err(`Project ${id} has no ${file}: a project that comes from policy.yaml or from the demo cannot be described. Give it a folder in ${this.dir}/ first.`);
    let edited = source;
    for (const key of PROFILE_KEYS) {
      const given = profile[key];
      if (given === undefined) continue;
      const value = given === null ? null : ProjectFileSchema.shape[key].safeParse(given);
      if (value && !value.success) return err(`The ${key} was not saved: ${value.error.issues.map((issue) => issue.message).join("; ")}.`);
      const next = withProfileKey(edited, key, value?.data ?? null);
      if (!next.ok) return err(`${file}: ${next.error}.`);
      edited = next.value;
    }
    const project = parseProjectFile(id, edited);
    if (project.ok && edited !== source) await writeFile(file, edited);
    return project;
  }
}

export class FileBriefingStore implements BriefingStore {
  constructor(
    private readonly dir: string,
    private readonly maxChars: number,
  ) {}

  async read(projectId: string): Promise<string | null> {
    const text = (await readFile(join(this.dir, projectId, "briefing.md"), "utf8").catch(() => "")).trim();
    if (!text) return null;
    return text.length <= this.maxChars ? text : `${text.slice(0, this.maxChars)}\n[briefing cut at ${this.maxChars} characters]`;
  }
}
