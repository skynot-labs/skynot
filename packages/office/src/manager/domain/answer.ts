import { z } from "zod";
import { WEEKDAYS, type TaskProposal } from "./ports";

const MAX_CONSULTED = 3;
const MAX_PLAN = 5;

export interface TeamChoices {
  readonly hire: readonly string[];
  readonly dismiss: readonly string[];
  readonly refocus?: readonly string[];
}

const MAX_BRIEFING = 1500;
// The prompt asks for 600. A model cannot count characters, and a slightly long answer is not worth a second run.
const MAX_MESSAGE = 1200;
const MAX_RELAY = 4000;
const MAX_TASK = 600;

// The orders a worker can be written to now: the ones waiting on a question it asked, and the ones in review.
export interface RelayTargets {
  readonly waiting: readonly string[];
  readonly inReview: readonly string[];
}

export function createAnswerSchema(
  orderSpec: z.ZodType,
  advisors: readonly string[] = [],
  choices: TeamChoices = { hire: [], dismiss: [], refocus: [] },
  openPlans: readonly string[] = [],
  relayTargets: RelayTargets = { waiting: [], inReview: [] },
  // Only a turn that starts from the director's own message may schedule a task.
  maySchedule = false,
) {
  return z
    .object({
      message: z.string().trim().min(1).max(MAX_MESSAGE),
      question: z.string().trim().min(3).max(300).nullable(),
      options: z.array(z.string().trim().min(1).max(40)).max(3),
      orders: z.array(orderSpec).max(MAX_PLAN).default([]),
      replaces: z.string().regex(/^WO-\d{4}$/).nullable().default(null),
      consult: z.array(z.object({ role: z.string(), question: z.string().trim().min(3).max(400) })).max(MAX_CONSULTED),
      team: z
        .object({
          action: z.enum(["hire", "dismiss", "refocus"]),
          role: z.string(),
          reason: z.string().trim().min(3).max(300),
          focus: z.string().trim().min(3).max(300).nullable().default(null),
        })
        .nullable(),
      briefing: z.object({ text: z.string().trim().min(3).max(MAX_BRIEFING), reason: z.string().trim().min(3).max(300) }).nullable().default(null),
      relay: z
        .object({ orderId: z.string().regex(/^WO-\d{4}$/), text: z.string().trim().min(1).max(MAX_RELAY), from: z.enum(["director", "manager"]) })
        .nullable()
        .default(null),
      schedule: z
        .object({
          title: z.string().trim().min(3).max(60),
          text: z.string().trim().min(3).max(MAX_TASK),
          when: z.union([
            z.object({ once: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/) }).strict(),
            z.object({ at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), days: z.array(z.enum(WEEKDAYS)).max(7).default([]) }).strict(),
          ]),
        })
        .nullable()
        .default(null),
    })
    .superRefine((answer, context) => {
      const proposes = answer.orders.length > 0;
      if (answer.question !== null && proposes) {
        context.addIssue({ code: "custom", path: ["orders"], message: "propose a plan or ask a question, never both" });
      }
      if (answer.replaces !== null && !proposes) {
        context.addIssue({ code: "custom", path: ["replaces"], message: "replaces goes with the orders of the new plan" });
      }
      if (answer.replaces !== null && !openPlans.includes(answer.replaces)) {
        const available = openPlans.length ? `plans awaiting signature: ${openPlans.join(", ")}` : "no plan is awaiting signature";
        context.addIssue({ code: "custom", path: ["replaces"], message: `cannot replace "${answer.replaces}"; ${available}` });
      }
      if (answer.question === null && answer.options.length > 0) {
        context.addIssue({ code: "custom", path: ["options"], message: "options are only allowed together with a question" });
      }
      if (answer.consult.length > 0 && (answer.question !== null || proposes)) {
        context.addIssue({ code: "custom", path: ["consult"], message: "consult on its own: leave question and orders empty" });
      }

      if (answer.team !== null) {
        if (answer.question !== null || proposes || answer.consult.length > 0) {
          context.addIssue({ code: "custom", path: ["team"], message: "propose a team change on its own: leave question, orders and consult empty" });
        }
        const allowed = answer.team.action === "hire" ? choices.hire : answer.team.action === "dismiss" ? choices.dismiss : (choices.refocus ?? []);
        if (!allowed.includes(answer.team.role)) {
          const available = allowed.length ? `available: ${allowed.join(", ")}` : `nobody can be ${answer.team.action === "hire" ? "hired" : answer.team.action === "dismiss" ? "dismissed" : "refocused"} now`;
          context.addIssue({ code: "custom", path: ["team", "role"], message: `cannot ${answer.team.action} "${answer.team.role}"; ${available}` });
        }
      }

      if (answer.team?.action === "refocus" && answer.team.focus === null) {
        context.addIssue({ code: "custom", path: ["team", "focus"], message: "a refocus needs the new focus" });
      }
      if (answer.briefing !== null && (answer.question !== null || proposes || answer.consult.length > 0 || answer.team !== null)) {
        context.addIssue({ code: "custom", path: ["briefing"], message: "propose a briefing change on its own: leave question, orders, consult and team empty" });
      }
      if (answer.relay !== null) {
        if (answer.question !== null || proposes || answer.consult.length > 0 || answer.team !== null || answer.briefing !== null) {
          context.addIssue({ code: "custom", path: ["relay"], message: "pass an answer on to a worker on its own: leave question, orders, consult, team and briefing empty" });
        }
        const targets = [...relayTargets.waiting, ...relayTargets.inReview];
        if (!targets.includes(answer.relay.orderId)) {
          const available = targets.length ? `orders waiting on an answer: ${relayTargets.waiting.join(", ") || "none"}; in review: ${relayTargets.inReview.join(", ") || "none"}` : "no worker is waiting on an answer and no order is in review";
          context.addIssue({ code: "custom", path: ["relay", "orderId"], message: `cannot write to the worker of "${answer.relay.orderId}"; ${available}` });
        }
      }

      if (answer.schedule !== null) {
        if (!maySchedule) context.addIssue({ code: "custom", path: ["schedule"], message: "only a message from the director can schedule a task: leave it null" });
        if (answer.question !== null || proposes || answer.consult.length > 0 || answer.team !== null || answer.briefing !== null || answer.relay !== null) {
          context.addIssue({ code: "custom", path: ["schedule"], message: "schedule a task on its own: leave question, orders, consult, team, briefing and relay empty" });
        }
      }

      const seen = new Set<string>();
      answer.consult.forEach((request, index) => {
        const path = ["consult", index, "role"];
        if (advisors.length === 0) {
          context.addIssue({ code: "custom", path, message: "you cannot consult now: answer, ask or propose an order" });
        } else if (!advisors.includes(request.role)) {
          context.addIssue({ code: "custom", path, message: `unknown advisor "${request.role}"; available: ${advisors.join(", ")}` });
        } else if (seen.has(request.role)) {
          context.addIssue({ code: "custom", path, message: `consult ${request.role} only once` });
        }
        seen.add(request.role);
      });
    });
}

export type ManagerAnswer<Order = unknown> = {
  message: string;
  question: string | null;
  options: string[];
  orders: Order[];
  replaces: string | null;
  consult: Array<{ role: string; question: string }>;
  team: { action: "hire" | "dismiss" | "refocus"; role: string; reason: string; focus: string | null } | null;
  briefing: { text: string; reason: string } | null;
  relay: { orderId: string; text: string; from: "director" | "manager" } | null;
  schedule: Pick<TaskProposal, "title" | "text" | "when"> | null;
};

export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}
