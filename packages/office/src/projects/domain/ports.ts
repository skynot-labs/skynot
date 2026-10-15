import type { Result } from "../../kernel";
import type { ProjectCommands } from "./commands-change";
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

// Where signed commands go: the project's file, so they hold after a restart, and the shop that is running.
export interface ProjectCommandsWriter {
  write(projectId: string, commands: ProjectCommands): Promise<Result<void, string>>;
}
