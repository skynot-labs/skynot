import { FakeEngine, type EngineRequest, type FakeAnswer } from "../execution";

const MARKER = "## New message from the director\n";

const MANAGER_USAGE = { inputTokens: 18_400, outputTokens: 320, cachedInputTokens: 15_100 };
const DEVELOPER_USAGE = { inputTokens: 212_000, outputTokens: 6_800, cachedInputTokens: 187_000 };

export function createMockManager(): FakeEngine {
  const reply = (request: EngineRequest) => {
    const message = request.prompt.split(MARKER).at(-1)?.trim() ?? "";
    const idea = firstIdea(request.prompt, message);

    if (message.startsWith("Answer to ")) {
      return { structured: { message: "That settles it. Filing the order.", question: null, options: [], orders: [mockOrder(idea)], consult: [], team: null } };
    }
    if (message.toLowerCase().startsWith("/plan")) {
      const wanted = shorten(message.slice("/plan".length).trim() || "the idea", 40);
      const steps = [`Lay the ground for ${wanted}`, `Build ${wanted}`].map((title) => mockOrder(title));
      return { structured: { message: "Two steps, the second on top of the first. Sign the plan and they start in that sequence.", question: null, options: [], orders: [steps[0], { ...steps[1], needs: [1] }], consult: [], team: null } };
    }
    if (message.toLowerCase().startsWith("/ping")) {
      return { structured: { message: "Nothing on the bench but the paperwork.", question: null, options: [], orders: [], consult: [], team: null } };
    }
    return {
      structured: {
        message: "One thing before I write it up.",
        question: `Keep "${shorten(idea, 40)}" small, or cover the edge cases too?`,
        options: ["Keep it small", "Cover edge cases"],
        orders: [],
        consult: [],
        team: null,
      },
    };
  };
  const answer: FakeAnswer = (request) => ({ ...reply(request), usage: MANAGER_USAGE });
  return new FakeEngine(answer);
}

export function createMockDeveloper(): FakeEngine {
  return new FakeEngine(async () => ({ text: "Criterion 1: covered by the new test. Criterion 2: the negative case is tested.", costUsd: 0.31, usage: DEVELOPER_USAGE }));
}

function firstIdea(prompt: string, current: string): string {
  const conversation = prompt.split("## Conversation so far, oldest first\n")[1]?.split("\n\n## New message")[0] ?? "";
  const first = conversation.split("\n").find((line) => line.startsWith("director: ") && !line.includes("Answer to "));
  return (first?.slice("director: ".length) ?? current).trim();
}

function mockOrder(idea: string) {
  const title = shorten(idea, 60);
  return {
    title,
    summary: `You get what you asked for: ${shorten(idea, 200)}.`,
    approach: ["Add the behavior behind the existing entry point", "Cover it with a test"],
    objective: `Deliver what the director asked for: ${shorten(idea, 200)}.`,
    acceptanceCriteria: [
      { statement: "The requested behavior works end to end", verification: { kind: "test", detail: "a new test covers the happy path" } },
      { statement: "Existing behavior does not change", verification: { kind: "command", detail: "npm test passes" } },
    ],
    outOfScope: ["Anything not named in the request"],
    risk: "low",
    likelyFiles: ["src/feature.txt"],
  };
}

const shorten = (text: string, length: number): string => (text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`);
