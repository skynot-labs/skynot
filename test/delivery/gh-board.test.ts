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
    "project item-list": JSON.stringify({ items: [] }),
    "project item-add": JSON.stringify({ id: "ITEM_1" }),
    "project item-create": JSON.stringify({ id: "NOTE_1" }),
    "project item-edit": "{}",
    ...overrides,
  };
  const execute: Exec = async (command, args) => {
    calls.push([command, ...args]);
    const answer = answers[`${args[0]} ${args[1]}`] ?? "";
    return answer === "FAIL" ? { stdout: "", stderr: "resource not found", code: 1 } : { stdout: answer, stderr: "", code: 0 };
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

  it("moves the card that is already there, whether it is the issue or a note that starts with its address", async () => {
    const url = "https://github.com/a/b/issues/7";
    const items = [{ id: "REAL", content: { url: "https://github.com/a/b/issues/9" } }, { id: "NOTE", content: { body: `${url}\nanything the director added` } }];
    const { board: github, calls } = board({ "project item-list": JSON.stringify({ items }) });

    await github.place({ url, stage: "done" });
    await github.place({ url: "https://github.com/a/b/issues/9", stage: "done" });
    await github.place({ url, stage: "proposed" });

    expect(calls.filter((call) => call[2] === "item-edit").map((call) => call[4])).toEqual(["NOTE", "REAL", "NOTE"]);
    expect(calls.filter((call) => call[2] === "item-add" || call[2] === "item-create")).toEqual([]);
    expect(calls.filter((call) => call[2] === "item-list")).toHaveLength(2);
  });

  it("leaves a note with the issue's address when the board's account cannot see the repository", async () => {
    const { board: github, calls } = board({ "project item-add": "FAIL" });

    await github.place({ url: "https://github.com/someone/todo/issues/25", stage: "proposed", title: "Add a version command" });

    expect(calls.find((call) => call[2] === "item-create")).toEqual(["gh", "project", "item-create", "13", "--owner", "rodacato", "--title", "todo#25 Add a version command", "--body", "https://github.com/someone/todo/issues/25", "--format", "json"]);
    expect(calls.find((call) => call[2] === "item-edit")?.[4]).toBe("NOTE_1");
  });

  it("says which Status option the board lacks instead of moving the card somewhere else", async () => {
    const { board: github } = board();

    await expect(github.place({ url: "https://github.com/a/b/issues/7", stage: "in_review" })).rejects.toThrow('no Status option named "In Review"');
  });
});
