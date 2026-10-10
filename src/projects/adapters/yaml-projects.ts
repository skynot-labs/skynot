import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { err, ok, type Result } from "../../kernel";
import { PROJECT_ID, ProjectFileSchema, toProject, type BriefingStore, type Project, type ProjectCatalog } from "../domain";

const PLACEHOLDER_REPO = "OWNER/REPO";

export function parseProjectFile(id: string, source: string): Result<Project, string> {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (error) {
    return err(`projects/${id}/project.yaml is not valid YAML: ${(error as Error).message}`);
  }
  const parsed = ProjectFileSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    return err(`projects/${id}/project.yaml is invalid: ${detail}`);
  }
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
      if (!PROJECT_ID.test(entry.name)) throw new Error(`${this.dir}/${entry.name}: a project folder is named in lowercase letters, digits and dashes`);
      const source = await readFile(join(this.dir, entry.name, "project.yaml"), "utf8").catch(() => null);
      if (source === null) throw new Error(`${this.dir}/${entry.name} has no project.yaml`);
      const project = parseProjectFile(entry.name, source);
      if (!project.ok) throw new Error(project.error);
      projects.push(project.value);
    }
    return projects;
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
