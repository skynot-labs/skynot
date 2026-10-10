import { z } from "zod";

const MAX_CONSULTED = 3;

export interface TeamChoices {
  readonly hire: readonly string[];
  readonly dismiss: readonly string[];
}

export function createAnswerSchema(orderSpec: z.ZodType, advisors: readonly string[] = [], choices: TeamChoices = { hire: [], dismiss: [] }) {
  return z
    .object({
      message: z.string().trim().min(1).max(600),
      question: z.string().trim().min(3).max(300).nullable(),
      options: z.array(z.string().trim().min(1).max(40)).max(3),
      order: orderSpec.nullable(),
      consult: z.array(z.object({ role: z.string(), question: z.string().trim().min(3).max(400) })).max(MAX_CONSULTED),
      team: z.object({ action: z.enum(["hire", "dismiss"]), role: z.string(), reason: z.string().trim().min(3).max(300) }).nullable(),
    })
    .superRefine((answer, context) => {
      if (answer.question !== null && answer.order !== null) {
        context.addIssue({ code: "custom", path: ["order"], message: "propose an order or ask a question, never both" });
      }
      if (answer.question === null && answer.options.length > 0) {
        context.addIssue({ code: "custom", path: ["options"], message: "options are only allowed together with a question" });
      }
      if (answer.consult.length > 0 && (answer.question !== null || answer.order !== null)) {
        context.addIssue({ code: "custom", path: ["consult"], message: "consult on its own: leave question and order empty" });
      }

      if (answer.team !== null) {
        if (answer.question !== null || answer.order !== null || answer.consult.length > 0) {
          context.addIssue({ code: "custom", path: ["team"], message: "propose a team change on its own: leave question, order and consult empty" });
        }
        const allowed = answer.team.action === "hire" ? choices.hire : choices.dismiss;
        if (!allowed.includes(answer.team.role)) {
          const available = allowed.length ? `available: ${allowed.join(", ")}` : `nobody can be ${answer.team.action === "hire" ? "hired" : "dismissed"} now`;
          context.addIssue({ code: "custom", path: ["team", "role"], message: `cannot ${answer.team.action} "${answer.team.role}"; ${available}` });
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
  order: Order | null;
  consult: Array<{ role: string; question: string }>;
  team: { action: "hire" | "dismiss"; role: string; reason: string } | null;
};

export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}
