import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline } from "../src/ui/markdown";

const kinds = (text: string) => parseBlocks(text).map((block) => block.kind);

describe("an agent's text, read as the little markdown agents write", () => {
  it("tells code, bold and a web link from plain text", () => {
    expect(parseInline("Run `npm test` and **stop**, see [docs](https://example.com/a).")).toEqual([
      { kind: "text", value: "Run " },
      { kind: "code", value: "npm test" },
      { kind: "text", value: " and " },
      { kind: "bold", value: "stop" },
      { kind: "text", value: ", see " },
      { kind: "link", value: "docs", href: "https://example.com/a" },
      { kind: "text", value: "." },
    ]);
  });

  it("leaves a lone asterisk or backtick as text, so a glob or a typo is not swallowed", () => {
    expect(parseInline("src/*.ts and a ` alone")).toEqual([{ kind: "text", value: "src/*.ts and a ` alone" }]);
  });

  it("never makes a link out of anything but http or https", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", value: "[x](javascript:alert(1))" }]);
  });

  it("keeps the lines of a paragraph together and starts a new one at a blank line", () => {
    expect(parseBlocks("one\ntwo\n\nthree")).toEqual([
      { kind: "paragraph", content: [{ kind: "text", value: "one\ntwo" }] },
      { kind: "paragraph", content: [{ kind: "text", value: "three" }] },
    ]);
  });

  it("groups bullets and numbered steps into their own lists, and reads a heading", () => {
    const blocks = parseBlocks("## Risks\n- first\n- second\n1. do this\n2) then that\nafter");

    expect(blocks.map((block) => block.kind)).toEqual(["heading", "bullets", "steps", "paragraph"]);
    expect(blocks[1]).toMatchObject({ items: [[{ value: "first" }], [{ value: "second" }]] });
    expect(blocks[2]).toMatchObject({ items: [[{ value: "do this" }], [{ value: "then that" }]] });
  });

  it("keeps a fenced block as it was written, and closes one the agent forgot to close", () => {
    expect(parseBlocks("before\n```ts\nconst a = **1**;\n- not a list\n```\nafter")).toEqual([
      { kind: "paragraph", content: [{ kind: "text", value: "before" }] },
      { kind: "code", value: "const a = **1**;\n- not a list" },
      { kind: "paragraph", content: [{ kind: "text", value: "after" }] },
    ]);
    expect(kinds("```\nnever closed")).toEqual(["code"]);
  });

  it("makes nothing of an empty text", () => {
    expect(parseBlocks("  \n\n")).toEqual([]);
  });
});
