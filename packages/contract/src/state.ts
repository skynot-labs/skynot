import { z } from "zod";
import { MINUTES_BUCKETS } from "./formats";

const timestamp = z.iso.datetime();
const count = z.number().int().nonnegative();
const issueNumber = z.number().int().positive();

export const EngineNameSchema = z.enum(["claude", "codex"]);
export type EngineName = z.infer<typeof EngineNameSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  repo: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

// `needsYou` is the sum of the four counts before it.
export const ProjectSummarySchema = ProjectSchema.extend({
  paused: z.boolean(),
  awaitingSignature: count,
  changes: count,
  blocked: count,
  questions: count,
  needsYou: count,
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const FindingSchema = z.object({
  check: z.string(),
  level: z.enum(["ok", "warn", "fail"]),
  detail: z.string(),
  fix: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const OrderStatusSchema = z.enum(["awaiting_signature", "signed", "on_bench", "in_review", "delivered", "discarded"]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const RiskSchema = z.enum(["low", "medium", "high"]);
export type Risk = z.infer<typeof RiskSchema>;

export const MinutesBucketSchema = z.enum(MINUTES_BUCKETS);
export type MinutesBucket = z.infer<typeof MinutesBucketSchema>;

export const ChecksStateSchema = z.enum(["none", "pending", "passing", "failing"]);
export type ChecksState = z.infer<typeof ChecksStateSchema>;

export const CriterionSchema = z.object({
  statement: z.string(),
  verification: z.object({ kind: z.enum(["command", "test", "behavior"]), detail: z.string() }),
});
export type Criterion = z.infer<typeof CriterionSchema>;

export const ReviewSchema = z.object({
  verdict: z.enum(["approved", "changes_requested"]),
  summary: z.string(),
  findings: z.array(z.string()).readonly(),
  diffOnly: z.boolean(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const AnsweredQuestionSchema = z.object({
  question: z.string(),
  answer: z.string(),
  from: z.string(),
  askedAt: timestamp,
  answeredAt: timestamp,
});
export type AnsweredQuestion = z.infer<typeof AnsweredQuestionSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  // The first order of the plan this one was proposed in; an order proposed alone is its own plan.
  plan: z.string(),
  title: z.string(),
  summary: z.string(),
  objective: z.string(),
  context: z.string().nullable(),
  approach: z.array(z.string()),
  likelyFiles: z.array(z.string()),
  risk: RiskSchema,
  criteria: z.array(CriterionSchema),
  outOfScope: z.array(z.string()),
  status: OrderStatusSchema,
  card: z.string(),
  pullRequest: issueNumber.nullable(),
  ticket: issueNumber.nullable(),
  minutes: MinutesBucketSchema.nullable(),
  proposedAt: timestamp,
  signedAt: timestamp.nullable(),
  deliveredAt: timestamp.nullable(),
  spentUsd: z.number(),
  working: z.boolean(),
  issue: issueNumber.nullable(),
  issueUrl: z.string().nullable(),
  pullRequestUrl: z.string().nullable(),
  blocked: z.string().nullable(),
  protectedPaths: z.array(z.string()).readonly(),
  approvedPaths: z.array(z.string()).readonly(),
  waitingOn: z.array(z.string()).readonly(),
  worker: z.string().nullable(),
  question: z.string().nullable(),
  questionAt: timestamp.nullable(),
  answers: z.array(z.string()).readonly(),
  answered: z.array(AnsweredQuestionSchema).readonly(),
  reviews: count,
  review: ReviewSchema.nullable(),
  // null until the office has looked at the pull request's checks; "none" when it has and there are none.
  checks: ChecksStateSchema.nullable(),
  ready: z.boolean(),
});
export type Order = z.infer<typeof OrderSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  author: z.enum(["director", "manager", "ticket"]),
  text: z.string(),
  at: timestamp,
  orderId: z.string().nullable(),
  decisionId: z.string().nullable(),
  consulted: z.array(z.string()).readonly(),
});
export type Message = z.infer<typeof MessageSchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()).readonly(),
  askedAt: timestamp,
  ticket: issueNumber.nullable(),
  answer: z.string().nullable(),
  answeredAt: timestamp.nullable(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const InboxKindSchema = z.enum(["manager_question", "ticket_doubt", "worker_question"]);
export type InboxKind = z.infer<typeof InboxKindSchema>;

export const InboxItemSchema = z.object({
  id: z.string(),
  kind: InboxKindSchema,
  from: z.string(),
  question: z.string(),
  options: z.array(z.string()).readonly(),
  orderId: z.string().nullable(),
  ticket: issueNumber.nullable(),
  // Empty when the office does not know when a worker asked.
  askedAt: z.union([timestamp, z.literal("")]),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export const AnsweredSchema = z.object({
  id: z.string(),
  kind: InboxKindSchema,
  from: z.string(),
  question: z.string(),
  answer: z.string(),
  orderId: z.string().nullable(),
  ticket: issueNumber.nullable(),
  askedAt: timestamp,
  answeredAt: timestamp,
});
export type Answered = z.infer<typeof AnsweredSchema>;

export const TeamRoleSchema = z.object({
  role: z.string(),
  name: z.string().nullable(),
  engine: EngineNameSchema,
  model: z.string().nullable(),
});
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const SoulSchema = z.object({
  role: z.string(),
  description: z.string(),
  soul: z.string(),
  focus: z.string().nullable(),
});
export type Soul = z.infer<typeof SoulSchema>;

export const InstructionsSchema = z.object({ role: z.string(), text: z.string() });
export type Instructions = z.infer<typeof InstructionsSchema>;

export const TeamChangeSchema = z.object({
  id: z.string(),
  action: z.enum(["hire", "dismiss", "refocus"]),
  role: z.string(),
  reason: z.string(),
  focus: z.string().nullable(),
  status: z.enum(["pending", "signed", "discarded"]),
  proposedAt: timestamp,
});
export type TeamChange = z.infer<typeof TeamChangeSchema>;

export const BriefingChangeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  text: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "signed", "discarded"]),
  proposedAt: timestamp,
});
export type BriefingChange = z.infer<typeof BriefingChangeSchema>;

export const HireableSchema = z.object({ name: z.string(), description: z.string() });
export type Hireable = z.infer<typeof HireableSchema>;

export const PausedBySchema = z.enum(["director", "cost_cap"]);
export type PausedBy = z.infer<typeof PausedBySchema>;

// `by` is absent for a pause recorded before the office said who paused.
export const PauseStateSchema = z.object({ since: timestamp, reason: z.string(), by: PausedBySchema.optional() });
export type PauseState = z.infer<typeof PauseStateSchema>;

// inputTokens is the whole input, cached part included.
export const TokenUsageSchema = z.object({
  inputTokens: count,
  outputTokens: count,
  cachedInputTokens: count.nullable(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const DailyCostSchema = z.object({ day: z.iso.date(), usd: z.number() });
export type DailyCost = z.infer<typeof DailyCostSchema>;

// Costs are what the engines reported, so each sum is a floor. `today`, `days`, `total` and `cap` are the whole office's.
export const CostsSchema = z.object({
  today: z.number(),
  days: z.array(DailyCostSchema),
  total: z.number(),
  cap: z.number().nullable(),
  project: z.number(),
  tokens: TokenUsageSchema.nullable(),
});
export type Costs = z.infer<typeof CostsSchema>;

export const RunOutcomeSchema = z.enum(["completed", "failed", "cancelled", "interrupted"]);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

export const RunFailureSchema = z.object({
  kind: z.enum(["timeout", "failed", "engine_unavailable", "cancelled", "interrupted"]),
  message: z.string(),
});
export type RunFailure = z.infer<typeof RunFailureSchema>;

export const RunSchema = z.object({
  runId: z.string(),
  role: z.string(),
  engine: EngineNameSchema,
  model: z.string().nullable(),
  turns: count.nullable(),
  orderId: z.string().nullable(),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  outcome: RunOutcomeSchema.nullable(),
  failure: RunFailureSchema.nullable(),
  costUsd: z.number().nullable(),
  usage: TokenUsageSchema.nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export const RoleUsageSchema = z.object({
  role: z.string(),
  runs: count,
  spentUsd: z.number().nullable(),
  usage: TokenUsageSchema.nullable(),
  lastOutcome: RunOutcomeSchema.nullable(),
});
export type RoleUsage = z.infer<typeof RoleUsageSchema>;

export const WorkingRunSchema = z.object({
  runId: z.string(),
  role: z.string(),
  engine: EngineNameSchema,
  orderId: z.string().nullable(),
  since: timestamp.nullable(),
});
export type WorkingRun = z.infer<typeof WorkingRunSchema>;

export const WaitingRunSchema = z.object({
  runId: z.string(),
  role: z.string(),
  orderId: z.string().nullable(),
  position: z.number().int().positive().nullable(),
});
export type WaitingRun = z.infer<typeof WaitingRunSchema>;

export const PresenceSchema = z.object({ working: z.array(WorkingRunSchema), waiting: z.array(WaitingRunSchema) });
export type Presence = z.infer<typeof PresenceSchema>;

export const PreferencesSchema = z.record(z.string(), z.record(z.string(), z.unknown()));
export type Preferences = z.infer<typeof PreferencesSchema>;

export const ActivitySchema = z.object({
  sequence: count,
  at: timestamp,
  orderId: z.string().nullable(),
  projectId: z.string(),
  role: z.string().nullable(),
  by: z.string().nullable(),
  kind: z.enum(["order", "delivery", "run", "advice"]),
  text: z.string(),
  url: z.string().nullable(),
});
export type Activity = z.infer<typeof ActivitySchema>;

// One project's view of the office: `projects`, `readiness`, `paused`, `preferences` and `cursor` are the same whichever project is asked for.
export const StateSchema = z.object({
  project: ProjectSchema,
  projects: z.array(ProjectSummarySchema),
  repo: z.string(),
  reviewing: z.boolean(),
  readiness: z.array(FindingSchema).readonly(),
  workers: z.array(z.string()),
  cursor: count,
  orders: z.array(OrderSchema),
  chat: z.array(MessageSchema).readonly(),
  decisions: z.array(DecisionSchema),
  inbox: z.array(InboxItemSchema),
  answered: z.array(AnsweredSchema),
  team: z.array(TeamRoleSchema),
  souls: z.array(SoulSchema),
  instructions: z.array(InstructionsSchema),
  teamChanges: z.array(TeamChangeSchema),
  briefingChanges: z.array(BriefingChangeSchema),
  briefing: z.string().nullable(),
  hireable: z.array(HireableSchema),
  paused: PauseStateSchema.nullable(),
  projectPaused: PauseStateSchema.nullable(),
  costs: CostsSchema,
  runs: z.array(RunSchema),
  agents: z.array(RoleUsageSchema),
  preferences: PreferencesSchema,
  presence: PresenceSchema,
  activity: z.array(ActivitySchema).readonly(),
  simulated: z.boolean(),
});
export type State = z.infer<typeof StateSchema>;
