import { z } from "zod";

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

export function createAnswerSchema(
  orderSpec: z.ZodType,
  advisors: readonly string[] = [],
  choices: TeamChoices = { hire: [], dismiss: [], refocus: [] },
  openPlans: readonly string[] = [],
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
};

export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}
