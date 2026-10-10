import type { Result } from "../../kernel";
import type { Team } from "./team";

export interface TeamRepository {
  forProject(projectId: string): Promise<Result<Team, string>>;
}
