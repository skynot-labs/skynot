import { z } from "zod";

export const MAX_PROJECT_NAME = 60;
export const MAX_PROJECT_DESCRIPTION = 280;

export const ProjectFileSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().trim().min(1, "a name cannot be empty").max(MAX_PROJECT_NAME, `a name has at most ${MAX_PROJECT_NAME} characters`).optional(),
  description: z.string().trim().max(MAX_PROJECT_DESCRIPTION, `a description has at most ${MAX_PROJECT_DESCRIPTION} characters`).optional(),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "a repository is written owner/name"),
  base_branch: z.string().min(1),
  setup_command: z.string().min(1).nullable(),
  verify_commands: z.array(z.string().min(1)).min(1),
  protected_paths: z.array(z.string().min(1)),
  board: z
    .strictObject({
      owner: z.string().min(1),
      number: z.number().int().positive(),
      columns: z.strictObject({ proposed: z.string(), in_progress: z.string(), in_review: z.string(), done: z.string() }).partial().optional(),
    })
    .optional(),
});

export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const PROJECT_ID = /^[a-z][a-z0-9-]{1,39}$/;

export interface Project {
  readonly id: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly repo: string;
  readonly baseBranch: string;
  readonly setupCommand: string | null;
  readonly verifyCommands: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly board?: ProjectBoard;
}

// The project's GitHub board, and the names of its Status options when they are not the usual ones.
export interface ProjectBoard {
  readonly owner: string;
  readonly number: number;
  readonly columns: Readonly<Record<"proposed" | "in_progress" | "in_review" | "done", string>>;
}

const DEFAULT_COLUMNS = { proposed: "Todo", in_progress: "In Progress", in_review: "In Progress", done: "Done" } as const;

function columnsOf(given: Partial<Record<keyof typeof DEFAULT_COLUMNS, string | undefined>> = {}): ProjectBoard["columns"] {
  return {
    proposed: given.proposed ?? DEFAULT_COLUMNS.proposed,
    in_progress: given.in_progress ?? DEFAULT_COLUMNS.in_progress,
    in_review: given.in_review ?? DEFAULT_COLUMNS.in_review,
    done: given.done ?? DEFAULT_COLUMNS.done,
  };
}

export function toProject(id: string, file: ProjectFile): Project {
  return {
    id,
    name: file.name ?? null,
    description: file.description || null,
    repo: file.repo,
    baseBranch: file.base_branch,
    setupCommand: file.setup_command,
    verifyCommands: file.verify_commands,
    protectedPaths: file.protected_paths,
    ...(file.board && { board: { owner: file.board.owner, number: file.board.number, columns: columnsOf(file.board.columns) } }),
  };
}

// An audit trail and a signal that the list changed: the folders stay the only source of what a project is.
export type ProjectEvent =
  | { type: "projects.registered"; payload: { projectId: string } }
  | { type: "projects.described"; payload: { projectId: string } };
