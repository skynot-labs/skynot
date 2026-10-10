import type { Result } from "../../kernel";
import type { Project, ProjectFile } from "./project";

export interface ProjectCatalog {
  list(): Promise<Project[]>;
}

// What the director keeps about a project that must not go in its repository.
export interface BriefingStore {
  read(projectId: string): Promise<string | null>;
}

export interface ProjectProfile {
  readonly name?: string | null;
  readonly description?: string | null;
}

// The director's way to add a project and to say what it is; never handed to an agent.
export interface ProjectRegistry {
  register(id: string, file: ProjectFile): Promise<Result<Project, string>>;
  describe(id: string, profile: ProjectProfile): Promise<Result<Project, string>>;
}
