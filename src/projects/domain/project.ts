import { z } from "zod";

export const ProjectFileSchema = z.strictObject({
  version: z.literal(1),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
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

export const PROJECT_ID = /^[a-z][a-z0-9-]{1,39}$/;

export interface Project {
  readonly id: string;
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

export function toProject(id: string, file: z.infer<typeof ProjectFileSchema>): Project {
  return {
    id,
    repo: file.repo,
    baseBranch: file.base_branch,
    setupCommand: file.setup_command,
    verifyCommands: file.verify_commands,
    protectedPaths: file.protected_paths,
    ...(file.board && { board: { owner: file.board.owner, number: file.board.number, columns: columnsOf(file.board.columns) } }),
  };
}
