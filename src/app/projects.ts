import { existsSync } from "node:fs";
import type { Policy } from "../governance";
import { FileBriefingStore, PROJECT_ID, YamlProjectCatalog, type BriefingStore, type Project } from "../projects";

export const PROJECTS_DIR = process.env.SKYNOT_PROJECTS ?? "projects";

// A shop that still lists its repository in policy.yaml works until the director moves it to projects/.
export function projectsFromPolicy(policy: Policy): Project[] {
  return policy.repos.map((repo) => ({
    id: idFromRepo(repo.name),
    name: null,
    description: null,
    repo: repo.name,
    baseBranch: repo.base_branch,
    setupCommand: repo.setup_command,
    verifyCommands: repo.verify_commands,
    protectedPaths: repo.protected_paths,
  }));
}

function idFromRepo(repo: string): string {
  const id = repo.split("/")[1]!.toLowerCase();
  if (!PROJECT_ID.test(id)) throw new Error(`policy.yaml lists ${repo}, whose name cannot be a project id. Move it to projects/<id>/project.yaml, with a folder named in lowercase letters, digits and dashes.`);
  return id;
}

const DEMO: Project = { id: "demo", name: null, description: null, repo: "demo/todo", baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [".github/"] };

export async function readProjects(policy: Policy, mock = false, dir = PROJECTS_DIR): Promise<Project[]> {
  if (mock && !existsSync(dir)) return [DEMO];
  const listed = await new YamlProjectCatalog(dir).list();
  const projects = listed.length > 0 ? listed : projectsFromPolicy(policy);
  // The first project owns the history written before projects existed: the one policy.yaml always named first.
  const legacy = projects.findIndex((project) => project.repo === policy.repos[0]?.name);
  if (legacy > 0) projects.unshift(...projects.splice(legacy, 1));
  const twice = projects.find((project, index) => projects.findIndex((other) => other.repo === project.repo) !== index);
  if (twice) throw new Error(`two projects work on ${twice.repo}: a repository belongs to one project`);
  const placeholder = projects.find((project) => project.repo === "OWNER/REPO");
  if (placeholder) throw new Error(`project ${placeholder.id} still lists the placeholder OWNER/REPO: set its repository`);
  if (projects.length === 0) throw new Error(`no project: add a folder to ${dir}/ (see projects.example/) or list a repository in policy.yaml`);
  return projects;
}

export const briefingStore = (policy: Policy, dir = PROJECTS_DIR): BriefingStore => new FileBriefingStore(dir, policy.memory.max_memory_chars);

export interface ProjectsFolder {
  readonly dir: string;
  readonly holdsProjects: boolean;
}

export async function projectsFolder(dir = PROJECTS_DIR): Promise<ProjectsFolder> {
  return { dir, holdsProjects: (await new YamlProjectCatalog(dir).list()).length > 0 };
}

// What readProjects would do to the running shop at its next start if this project got a folder now.
export function registrationProblem(input: { id: string; repo: string }, current: readonly Project[], folder: ProjectsFolder, policyRepos: readonly string[]): string | null {
  if (current.some((project) => project.id === input.id)) return `There is already a project called ${input.id}: choose another id.`;
  const owner = current.find((project) => project.repo.toLowerCase() === input.repo.toLowerCase());
  if (owner) return `${owner.repo} already belongs to the project ${owner.id}: a repository belongs to one project.`;
  const first = current[0];
  if (!first) return null;
  const ids = current.map((project) => project.id).join(", ");
  if (!folder.holdsProjects) {
    const source = policyRepos.includes(first.repo) ? "the repos list in policy.yaml" : "the simulated demo";
    return `The shop is running ${ids} from ${source}, not from ${folder.dir}/. Registering ${input.id} would create the first project folder, and at the next start ${ids} would vanish because only the folders would be read. Create ${folder.dir}/<id>/project.yaml for each current project first (see projects.example/), restart, then register ${input.id}.`;
  }
  if (current.some((project) => project.repo === policyRepos[0])) return null;
  const inherits = `the first project owns the history recorded before projects existed, which today is ${first.id}'s`;
  if (input.repo === policyRepos[0]) return `policy.yaml names ${input.repo} first, so ${input.id} would become the first project, and ${inherits}. Take ${input.repo} out of the first place of repos in policy.yaml, restart, then register it.`;
  if (input.id.localeCompare(first.id) < 0) return `${input.id} sorts before ${first.id}, so it would become the first project, and ${inherits}. Choose an id that sorts after ${first.id}.`;
  return null;
}
