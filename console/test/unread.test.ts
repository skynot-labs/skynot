import { describe, expect, it } from "vitest";
import type { Message } from "../src/contracts";
import { unreadReplies } from "../src/application/unread";

const chat = (...authors: Array<Message["author"]>) => authors.map((author, index) => ({ id: `m${index}`, author })) as unknown as Message[];

describe("the replies the director has not seen", () => {
  it("counts what the Manager said after the last message seen", () => {
    expect(unreadReplies(chat("director", "manager", "manager"), 1)).toBe(2);
    expect(unreadReplies(chat("director", "manager", "manager"), 2)).toBe(1);
  });

  it("never counts the director's own messages", () => {
    expect(unreadReplies(chat("manager", "director", "director"), 1)).toBe(0);
  });

  it("counts a ticket that came in as something to read", () => {
    expect(unreadReplies(chat("manager", "ticket"), 1)).toBe(1);
  });

  it("has nothing unread when all of it was seen, or when nothing was ever marked", () => {
    expect(unreadReplies(chat("director", "manager"), 2)).toBe(0);
    expect(unreadReplies(chat("director", "manager"), null)).toBe(0);
  });
});
