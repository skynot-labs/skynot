import { z } from "zod";
import {
  BRIEFING_CHANGE_ID,
  MAX_FOCUS,
  MAX_PROJECT_DESCRIPTION,
  MAX_PROJECT_NAME,
  MAX_TEXT,
  MIN_FOCUS,
  MINUTES_BUCKETS,
  ORDER_ID,
  PREFERENCE_KEY,
  PROJECT_ID,
  REPOSITORY,
  ROLE_NAME,
  RUN_ID,
  TEAM_CHANGE_ID,
  TIME_OF_DAY,
} from "./formats";

const text = z.string().trim().min(1).max(MAX_TEXT);
const orderId = z.string().regex(ORDER_ID);
const projectId = z.string().regex(PROJECT_ID);
const roleName = z.string().regex(ROLE_NAME);
const line = z.string().min(1);

const nothing = z.object({});
const oneOrder = z.object({ orderId });
const oneProject = z.object({ project: projectId });
const oneTeamChange = z.object({ changeId: z.string().regex(TEAM_CHANGE_ID) });
const oneBriefingChange = z.object({ changeId: z.string().regex(BRIEFING_CHANGE_ID) });

export const commands = {
  "send-message": z.object({ text, project: projectId.optional() }),
  "answer-decision": z.object({ decisionId: z.string().min(1), answer: text }),

  "sign-order": oneOrder,
  "sign-plan": z.object({ plan: orderId }),
  "retry-order": oneOrder,
  "apply-review": oneOrder,
  "answer-question": z.object({ orderId, answer: text }),
  "start-now": oneOrder,
  "review-order": oneOrder,
  "reassign-order": z.object({ orderId, worker: roleName }),
  "stop-order": oneOrder,
  "approve-protected-paths": oneOrder,
  "follow-up": z.object({ orderId, text }),
  "discard-order": oneOrder,
  "record-minutes": z.object({ orderId, bucket: z.enum(MINUTES_BUCKETS) }),

  recheck: nothing,
  "stop-run": z.object({ runId: z.string().regex(RUN_ID) }),
  "pause-shop": nothing,
  "resume-shop": nothing,
  "pause-project": oneProject,
  "resume-project": oneProject,

  "register-project": z.object({
    id: projectId,
    repo: z.string().regex(REPOSITORY),
    baseBranch: z.string().min(1),
    verifyCommands: z.array(line).min(1),
    setupCommand: line.optional(),
    protectedPaths: z.array(line).optional(),
    name: z.string().trim().min(1).max(MAX_PROJECT_NAME).optional(),
    description: z.string().trim().min(1).max(MAX_PROJECT_DESCRIPTION).optional(),
  }),
  "describe-project": z.object({ project: projectId, name: z.string().nullable().optional(), description: z.string().nullable().optional() }),
  "set-preference": z.object({ key: z.string().regex(PREFERENCE_KEY), value: z.record(z.string(), z.unknown()).nullable() }),

  "schedule-task": z.object({ project: projectId, task: z.string().min(1), on: z.boolean(), at: z.string().regex(TIME_OF_DAY) }),

  "set-focus": z.object({ project: projectId, role: roleName, focus: z.string().trim().min(MIN_FOCUS).max(MAX_FOCUS) }),
  "sign-team-change": oneTeamChange,
  "discard-team-change": oneTeamChange,
  "sign-briefing-change": oneBriefingChange,
  "discard-briefing-change": oneBriefingChange,

  "merge-pull-request": oneOrder,
};

export type CommandName = keyof typeof commands;
export type Command = { [Name in CommandName]: { name: Name; payload: z.input<(typeof commands)[Name]> } }[CommandName];

// An office answers these only when its shop is simulated, which its state says in `simulated`.
export const simulatedCommands: readonly CommandName[] = ["merge-pull-request"];

export const commandPath = (name: CommandName): string => `/api/${simulatedCommands.includes(name) ? "dev" : "commands"}/${name}`;
