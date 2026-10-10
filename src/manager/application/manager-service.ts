import { err, newId, ok, type Result } from "../../kernel";
import type { EventLog } from "../../kernel/events";
import {
  NO_ADVISORS,
  NO_TEAM_DESK,
  SYSTEM_PROMPT,
  buildAdvicePrompt,
  buildPrompt,
  buildRetryPrompt,
  createAnswerSchema,
  describeIssues,
  type AdvisorBench,
  type AdvisorReply,
  type DecisionId,
  type ManagerAnswer,
  type MessageId,
  type ModelRunner,
  type OrderDesk,
  type TeamDesk,
} from "../domain";
import type { ChatProjection } from "./chat-projection";

const MAX_ATTEMPTS = 3;
const CONVERSATION_WINDOW = 20;

export interface ManagerDependencies {
  log: EventLog;
  chat: ChatProjection;
  runner: ModelRunner;
  desk: OrderDesk;
  advisors?: AdvisorBench;
  team?: TeamDesk;
}

export class ManagerService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly bench: AdvisorBench;
  private readonly teamDesk: TeamDesk;

  constructor(private readonly deps: ManagerDependencies) {
    this.bench = deps.advisors ?? NO_ADVISORS;
    this.teamDesk = deps.team ?? NO_TEAM_DESK;
  }

  async idle(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  handleMessage(text: string): Promise<void> {
    return this.exclusive(() => this.takeTurn(text));
  }

  tell(text: string, link: { orderId?: string } = {}): Promise<void> {
    return this.exclusive(() => this.reply(text, link));
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

  // The team changes while the shop runs, so the rules for an answer are built for every turn.
  private schemas() {
    const onTeam = this.bench.roster().map((advisor) => advisor.name);
    const choices = { hire: this.teamDesk.hireable().map((role) => role.name), dismiss: onTeam };
    return {
      first: createAnswerSchema(this.deps.desk.specSchema, onTeam, choices),
      final: createAnswerSchema(this.deps.desk.specSchema, [], choices),
    };
  }

  private async takeTurn(text: string): Promise<void> {
    const { chat, desk, log } = this.deps;
    const schemas = this.schemas();

    const prompt = buildPrompt({
      orders: desk.overview(),
      advisors: this.bench.roster(),
      hireable: this.teamDesk.hireable(),
      openQuestions: chat.openDecisions().map((decision) => decision.question),
      conversation: chat.recent(CONVERSATION_WINDOW),
      message: text,
    });
    await log.record([{ type: "manager.message_received", payload: { messageId: newId("msg"), text } }]);

    const first = await this.ask(prompt, schemas.first);
    if (!first.ok) return this.reply(first.error);
    if (first.value.consult.length === 0) return this.act(first.value);

    const replies = await this.consult(first.value.consult);
    const second = await this.ask(buildAdvicePrompt(prompt, replies.map(describeReply)), schemas.final);
    return second.ok ? this.act(second.value) : this.reply(second.error);
  }

  private async ask(prompt: string, schema: ReturnType<typeof createAnswerSchema>): Promise<Result<ManagerAnswer, string>> {
    let feedback = "";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const raw = await this.deps.runner.ask({
        system: SYSTEM_PROMPT,
        prompt: feedback ? buildRetryPrompt(prompt, feedback) : prompt,
        schema,
      });
      if (!raw.ok) return err(`I could not reach the engine: ${raw.error}`);

      const parsed = schema.safeParse(raw.value);
      if (parsed.success) return ok(parsed.data as ManagerAnswer);
      feedback = describeIssues(parsed.error);
      await this.deps.log.record([{ type: "manager.answer_rejected", payload: { attempt, issues: feedback } }]);
    }
    return err("I could not produce a valid answer after 3 tries. Rephrase or add detail and I will try again.");
  }

  private async consult(requests: ManagerAnswer["consult"]): Promise<AdvisorReply[]> {
    const { log } = this.deps;
    await log.record(requests.map((request) => ({ type: "manager.consulted", payload: { role: request.role, question: request.question } })));

    let replies: AdvisorReply[];
    try {
      replies = await this.bench.consult(requests);
    } catch (error) {
      replies = requests.map((request) => ({ role: request.role, result: err((error as Error).message) }));
    }

    await log.record(
      replies.map((reply) =>
        reply.result.ok
          ? { type: "manager.advised", payload: { role: reply.role, answer: reply.result.value } }
          : { type: "manager.advisor_failed", payload: { role: reply.role, reason: reply.result.error } },
      ),
    );
    return replies;
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
    if (answer.team !== null) {
      const proposed = await this.teamDesk.propose(answer.team);
      return proposed.ok ? this.reply(`${answer.message}\n\n${proposed.value.text}`) : this.reply(`I could not propose that: ${proposed.error}`);
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

function describeReply(reply: AdvisorReply) {
  return reply.result.ok ? { role: reply.role, text: reply.result.value, failure: null } : { role: reply.role, text: null, failure: reply.result.error };
}
