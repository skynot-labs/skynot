import { cp, copyFile, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ID } from "../../projects";

const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;
const PLACEHOLDER = "OWNER/REPO";

export interface Repository {
  readonly name: string;
  readonly owner: string;
  readonly projectId: string;
}

export function parseRepository(answer: string): Repository | string {
  const name = answer.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (!REPOSITORY.test(name) || name === PLACEHOLDER) return `"${answer.trim()}" is not a repository: write it as owner/name, for example octocat/hello-world.`;
  const projectId = name.split("/")[1]!.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!PROJECT_ID.test(projectId)) return `${name} cannot name a project folder, which takes 2 to 40 lowercase letters, digits and dashes, starting with a letter. Copy projects.example by hand and name the folder yourself.`;
  return { name, owner: name.split("/")[0]!, projectId };
}

export interface ShopPaths {
  readonly root: string;
  readonly policy: string;
  readonly team: string;
  readonly projects: string;
}

const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

export const needsProject = async (paths: ShopPaths): Promise<boolean> => !(await exists(path.resolve(paths.root, paths.projects)));

export interface CopiedFiles {
  readonly created: string[];
  readonly kept: string[];
}

// A file that is already there is the director's: it is neither overwritten nor edited.
export async function copyExamples(paths: ShopPaths, repository: Repository | null): Promise<CopiedFiles> {
  const created: string[] = [];
  const kept: string[] = [];
  for (const [example, target] of [["policy.example.yaml", paths.policy], ["team.example.yaml", paths.team]] as const) {
    const file = path.resolve(paths.root, target);
    if (await exists(file)) kept.push(target);
    else {
      await copyFile(path.join(paths.root, example), file);
      created.push(target);
    }
  }

  const projects = path.resolve(paths.root, paths.projects);
  if (await exists(projects)) return { created, kept: [...kept, `${paths.projects}/`] };
  if (!repository) throw new Error(`${paths.projects}/ does not exist and no repository was given for its first project`);

  await cp(path.join(paths.root, "projects.example"), projects, { recursive: true, errorOnExist: true, force: false });
  const project = path.join(projects, repository.projectId);
  await rename(path.join(projects, "example"), project);
  const file = path.join(project, "project.yaml");
  await writeFile(file, (await readFile(file, "utf8")).replace(`repo: ${PLACEHOLDER}`, `repo: ${repository.name}`));
  return { created: [...created, `${paths.projects}/${repository.projectId}/`], kept };
}
