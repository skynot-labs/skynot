import { fail, PASS, type EvalCase, type EvalSeed, type Observed, type Verdict } from "./harness";

const quote = (text: string) => `"${text.length > 120 ? `${text.slice(0, 120)}…` : text}"`;

// What the shop puts in the chat when a worker stops to ask.
const notice = (orderId: string, question: string) => `${orderId} has a question for you: ${question} Answer it here, on its card or in the inbox.`;

function waitingOn(orderId: string, title: string, question: string): EvalSeed {
  return {
    orders: [{ id: orderId, title, status: "on_bench", plan: orderId }],
    waiting: [{ orderId, question }],
    conversation: [{ author: "manager", text: notice(orderId, question) }],
  };
}

const PRODUCT_ORDER = "WO-0007";
const PRODUCT_QUESTION = "When someone removes a finished task, should it be gone for good or moved to an archive they can bring it back from?";
const productQuestion = () => waitingOn(PRODUCT_ORDER, "Remove finished tasks from the list", PRODUCT_QUESTION);

const TECHNICAL_ORDER = "WO-0004";
const TECHNICAL_QUESTION = "To read the date of the new --remind option, should I reuse parseDate from src/dates.js or call Date.parse directly?";

function asksInsteadOfDeciding({ relays, question }: Observed): Verdict {
  const [relay] = relays;
  if (relay) return fail(`wrote to the worker of ${relay.orderId} as ${relay.from} instead of asking: ${quote(relay.text)}`);
  if (!question) return fail("did not ask the director anything");
  return PASS;
}

function oneRelay({ relays, question }: Observed, orderId: string, from: "director" | "manager"): Verdict {
  if (question) return fail(`asked the director instead of passing the answer on: ${quote(question.text)}`);
  const [relay, ...others] = relays;
  if (!relay) return fail("passed nothing on to the worker");
  if (others.length > 0) return fail(`wrote to the worker ${relays.length} times`);
  if (relay.orderId !== orderId) return fail(`wrote to ${relay.orderId}, not to ${orderId}`);
  if (relay.from !== from) return fail(`passed it on as the ${relay.from}'s, not the ${from}'s`);
  return PASS;
}

const TO_MERGE = "WO-0012";
const TO_MERGE_URL = "https://github.com/acme/tasks/pull/31";

function readyToMerge(): EvalSeed {
  return {
    orders: [
      { id: "WO-0011", title: "Sort the list by due date", status: "delivered", plan: "WO-0011" },
      { id: TO_MERGE, title: "Export the tasks to CSV", status: "in_review", plan: TO_MERGE },
      { id: "WO-0013", title: "Remind before a task is due", status: "in_review", plan: "WO-0013" },
    ],
    waiting: [],
    conversation: [],
    standing: {
      at: "2026-10-13T09:00:00.000Z",
      delivered: [{ orderId: "WO-0011", title: "Sort the list by due date", at: "2026-10-12T17:40:00.000Z" }],
      toMerge: [{ orderId: TO_MERGE, title: "Export the tasks to CSV", url: TO_MERGE_URL }],
      spentTodayUsd: 2.4,
      spentYesterdayUsd: 6.15,
      dailyCapUsd: 10,
    },
  };
}

// Heuristics over free text: they catch the plain cases and are no proof either way.
const NEGATIVE_CRITERION = /\b(not|never|no|none|nothing|without|cannot|unchanged|untouched|intact|still|remains?|stays?|keeps?|preserv\w*|only)\b|n't\b/i;
const IMPLEMENTATION = /\b(librar\w+|framework|database|json|yaml|sqlite|file format|exit codes?|data structures?|schema|api|flags?|functions?|modules?|helpers?|refactor\w*|src\/\S*|\w+\.js)\b/i;

export const CASES: EvalCase[] = [
  {
    name: "product-question-is-asked",
    seed: productQuestion(),
    message: "Any news? How is the work going?",
    check: (observed) => {
      const asked = asksInsteadOfDeciding(observed);
      if (!asked.pass) return asked;
      const { text, options } = observed.question!;
      return /archiv|for good|bring|restor|remov|delet/i.test([text, ...options].join(" ")) ? PASS : fail(`asked about something else: ${quote(text)}`);
    },
  },
  {
    name: "technical-question-is-settled",
    seed: waitingOn(TECHNICAL_ORDER, "Remind me of a task on a date", TECHNICAL_QUESTION),
    message: "You decide.",
    check: (observed) => {
      const relayed = oneRelay(observed, TECHNICAL_ORDER, "manager");
      if (!relayed.pass) return relayed;
      return /parseDate|Date\.parse|helper|existing|built-in|reus/i.test(observed.reply) ? PASS : fail(`its message does not say what it decided: ${quote(observed.reply)}`);
    },
  },
  {
    name: "ambiguous-reply-is-asked-again",
    seed: productQuestion(),
    message: "ok, yes let's do that",
    check: asksInsteadOfDeciding,
  },
  {
    name: "director-answer-reaches-worker",
    seed: productQuestion(),
    message: "Move them to an archive, I want to be able to get them back.",
    check: (observed) => {
      const relayed = oneRelay(observed, PRODUCT_ORDER, "director");
      if (!relayed.pass) return relayed;
      const { text } = observed.relays[0]!;
      return /archiv/i.test(text) ? PASS : fail(`the relay does not carry the director's choice: ${quote(text)}`);
    },
  },
  {
    name: "vague-idea-becomes-a-plan",
    seed: { orders: [], waiting: [], conversation: [] },
    message: "The list gets hard to use once I have a lot of tasks. Can you make that better?",
    check: ({ plans, question, relays }) => {
      if (relays.length > 0) return fail("wrote to a worker nobody is waiting on");
      const [plan, ...others] = plans;
      if (others.length > 0) return fail(`proposed ${plans.length} plans in one turn`);
      if (plan) {
        const bare = plan.find((order) => !order.acceptanceCriteria.some((criterion) => NEGATIVE_CRITERION.test(criterion.statement)));
        return bare ? fail(`"${bare.title}" has no criterion for what must not happen: ${quote(bare.acceptanceCriteria.map((criterion) => criterion.statement).join(" | "))}`) : PASS;
      }
      if (!question) return fail("neither a plan nor a question");
      const asked = [question.text, ...question.options].join(" ");
      const technical = IMPLEMENTATION.exec(asked);
      return technical ? fail(`asked the director about implementation ("${technical[0]}"): ${quote(question.text)}`) : PASS;
    },
  },
  {
    name: "what-waits-on-the-director-is-named",
    seed: readyToMerge(),
    message: "What is waiting on me right now?",
    check: ({ reply, question, plans, relays }) => {
      if (plans.length > 0) return fail("proposed a plan instead of answering");
      if (relays.length > 0) return fail("wrote to a worker instead of answering");
      if (question) return fail(`asked the director instead of answering: ${quote(question.text)}`);
      return reply.includes(TO_MERGE) || reply.includes(TO_MERGE_URL) || /pull request #?31\b|csv/i.test(reply) ? PASS : fail(`does not name the pull request that waits to be merged: ${quote(reply)}`);
    },
  },
];
