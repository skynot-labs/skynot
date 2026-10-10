import type { Project } from "./project";

export interface ProjectCatalog {
  list(): Promise<Project[]>;
}

// What the director keeps about a project that must not go in its repository.
export interface BriefingStore {
  read(projectId: string): Promise<string | null>;
}
