import { describe, expect, it } from "vitest";
import { GhBoard } from "../../src/delivery";
import type { Exec } from "../../src/kernel/process";

const columns = { proposed: "Todo", in_progress: "In Progress", in_review: "In Review", done: "Done" } as const;

function board(overrides: Record<string, string> = {}) {
  const calls: string[][] = [];
  const answers: Record<string, string> = {
    "project view": JSON.stringify({ id: "PVT_1" }),
    "project field-list": JSON.stringify({
      fields: [
        { id: "F_title", name: "Title" },
        { id: "F_status", name: "Status", options: [{ id: "O_todo", name: "Todo" }, { id: "O_doing", name: "In Progress" }, { id: "O_done", name: "Done" }] },
      ],
    }),
    "project item-add": JSON.stringify({ id: "ITEM_1" }),
    "project item-edit": "{}",
    ...overrides,
  };
  const execute: Exec = async (command, args) => {
    calls.push([command, ...args]);
    return { stdout: answers[`${args[0]} ${args[1]}`] ?? "", stderr: "", code: 0 };
  };
  return { calls, board: new GhBoard({ owner: "rodacato", number: 13, columns }, execute) };
}

describe("github board", () => {
  it("adds the card and sets its Status to the option with the stage's name", async () => {
    const { board: github, calls } = board();

    await github.place({ url: "https://github.com/a/b/issues/7", stage: "in_progress" });

    expect(calls.find((call) => call[2] === "item-add")).toEqual(["gh", "project", "item-add", "13", "--owner", "rodacato", "--url", "https://github.com/a/b/issues/7", "--format", "json"]);
    expect(calls.find((call) => call[2] === "item-edit")).toEqual(["gh", "project", "item-edit", "--id", "ITEM_1", "--project-id", "PVT_1", "--field-id", "F_status", "--single-select-option-id", "O_doing"]);
  });

  it("reads the board's layout once, however many cards move", async () => {
    const { board: github, calls } = board();

    await github.place({ url: "https://github.com/a/b/issues/7", stage: "proposed" });
    await github.place({ url: "https://github.com/a/b/issues/8", stage: "done" });

    expect(calls.filter((call) => call[2] === "view")).toHaveLength(1);
    expect(calls.filter((call) => call[2] === "field-list")).toHaveLength(1);
  });

  it("says which Status option the board lacks instead of moving the card somewhere else", async () => {
    const { board: github } = board();

    await expect(github.place({ url: "https://github.com/a/b/issues/7", stage: "in_review" })).rejects.toThrow('no Status option named "In Review"');
  });
});
