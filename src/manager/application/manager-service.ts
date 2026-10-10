import { err, newId, ok, type Result } from "../../kernel";
import type { EventLog } from "../../kernel/events";
import {
  SYSTEM_PROMPT,
  buildPrompt,
  buildRetryPrompt,
  createAnswerSchema,
  describeIssues,
  type DecisionId,
  type ManagerAnswer,
  type MessageId,
  type ModelRunner,
  type OrderDesk,
} from "../domain";
import type { ChatProjection } from "./chat-projection";

const MAX_ATTEMPTS = 3;
const CONVERSATION_WINDOW = 20;

export interface ManagerDependencies {
  log: EventLog;
  chat: ChatProjection;
  runner: ModelRunner;
  desk: OrderDesk;
}

export class ManagerService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly answerSchema;

  constructor(private readonly deps: ManagerDependencies) {
    this.answerSchema = createAnswerSchema(deps.desk.specSchema);
  }

  async idle(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  handleMessage(text: string): Promise<void> {
    return this.exclusive(() => this.takeTurn(text));
  }

  answerDecision(decisionId: string, answer: string): Promise<Result<void, string>> {
    return this.exclusive(async () => {
      const decision = this.deps.chat.decision(decisionId);
      if (!decision) return err(`no question ${decisionId}`);
      if (decision.answer !== null) return err("that question was already answered");

      await this.deps.log.record([{ type: "manager.decision_answered", payload: { decisionId: decision.id, answer } }]);
      await this.takeTurn(`Answer to "${decision.question}": ${answer}`);
      return ok(undefined);
    });
  }

  private async takeTurn(text: string): Promise<void> {
    const { chat, desk, log, runner } = this.deps;

    const prompt = buildPrompt({
      orders: desk.overview(),
      openQuestions: chat.openDecisions().map((decision) => decision.question),
      conversation: chat.recent(CONVERSATION_WINDOW),
      message: text,
    });
    await log.record([{ type: "manager.message_received", payload: { messageId: newId("msg"), text } }]);

    let feedback = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const raw = await runner.ask({
        system: SYSTEM_PROMPT,
        prompt: feedback ? buildRetryPrompt(prompt, feedback) : prompt,
        schema: this.answerSchema,
      });
      if (!raw.ok) return this.reply(`I could not reach the engine: ${raw.error}`);

      const parsed = this.answerSchema.safeParse(raw.value);
      if (parsed.success) return this.act(parsed.data as ManagerAnswer);
      feedback = describeIssues(parsed.error);
    }
    return this.reply("I could not produce a valid answer after 3 tries. Rephrase or add detail and I will try again.");
  }

  private async act(answer: ManagerAnswer): Promise<void> {
    if (answer.order !== null) {
      const proposed = await this.deps.desk.propose(answer.order);
      return proposed.ok
        ? this.reply(`${answer.message}\n\n${proposed.value.card}`, { orderId: proposed.value.id })
        : this.reply(`I could not file that order: ${proposed.error}`);
    }
    if (answer.question !== null) {
      const decisionId = newId("dec");
      await this.deps.log.record([
        { type: "manager.decision_asked", payload: { decisionId, question: answer.question, options: answer.options } },
      ]);
      return this.reply(answer.message, { decisionId });
    }
    return this.reply(answer.message);
  }

  private async reply(text: string, link: { orderId?: string; decisionId?: DecisionId } = {}): Promise<void> {
    const messageId: MessageId = newId("msg");
    await this.deps.log.record([
      { type: "manager.replied", payload: { messageId, text, orderId: link.orderId ?? null, decisionId: link.decisionId ?? null } },
    ]);
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
