import { existsSync } from "node:fs";
import type { Policy } from "../governance";
import { FileBriefingStore, YamlProjectCatalog, type BriefingStore, type Project } from "../projects";

export const PROJECTS_DIR = process.env.SKYNOT_PROJECTS ?? "projects";

// A shop that still lists its repository in policy.yaml works until the director moves it to projects/.
export function projectsFromPolicy(policy: Policy): Project[] {
  return policy.repos.map((repo) => ({
    id: repo.name.split("/")[1]!.toLowerCase(),
    repo: repo.name,
    baseBranch: repo.base_branch,
    setupCommand: repo.setup_command,
    verifyCommands: repo.verify_commands,
    protectedPaths: repo.protected_paths,
  }));
}

const DEMO: Project = { id: "demo", repo: "demo/todo", baseBranch: "main", setupCommand: null, verifyCommands: ["npm test"], protectedPaths: [".github/"] };

export async function readProjects(policy: Policy, mock = false, dir = PROJECTS_DIR): Promise<Project[]> {
  if (mock && !existsSync(dir)) return [DEMO];
  const projects = existsSync(dir) ? await new YamlProjectCatalog(dir).list() : projectsFromPolicy(policy);
  const placeholder = projects.find((project) => project.repo === "OWNER/REPO");
  if (placeholder) throw new Error(`project ${placeholder.id} still lists the placeholder OWNER/REPO: set its repository`);
  if (projects.length === 0) throw new Error(`no project: add a folder to ${dir}/ (see projects.example/) or list a repository in policy.yaml`);
  return projects;
}

export const briefingStore = (policy: Policy, dir = PROJECTS_DIR): BriefingStore => new FileBriefingStore(dir, policy.memory.max_memory_chars);
