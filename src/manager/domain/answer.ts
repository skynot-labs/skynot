import { z } from "zod";

export function createAnswerSchema(orderSpec: z.ZodType) {
  return z
    .object({
      message: z.string().trim().min(1).max(600),
      question: z.string().trim().min(3).max(300).nullable(),
      options: z.array(z.string().trim().min(1).max(40)).max(3),
      order: orderSpec.nullable(),
    })
    .superRefine((answer, context) => {
      if (answer.question !== null && answer.order !== null) {
        context.addIssue({ code: "custom", path: ["order"], message: "propose an order or ask a question, never both" });
      }
      if (answer.question === null && answer.options.length > 0) {
        context.addIssue({ code: "custom", path: ["options"], message: "options are only allowed together with a question" });
      }
    });
}

export type ManagerAnswer<Order = unknown> = {
  message: string;
  question: string | null;
  options: string[];
  order: Order | null;
};

export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}
