import { describe, expect, it } from "vitest";
import { ago } from "../src/ui/format";

const NOW = Date.parse("2026-10-11T12:00:00.000Z");
const before = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe("how long ago something happened", () => {
  it("counts minutes, then whole hours, then whole days", () => {
    expect(ago(before(0.5), NOW)).toBe("just now");
    expect(ago(before(1), NOW)).toBe("1 min ago");
    expect(ago(before(59), NOW)).toBe("59 min ago");
    expect(ago(before(60), NOW)).toBe("1 h ago");
    expect(ago(before(60 * 23 + 59), NOW)).toBe("23 h ago");
    expect(ago(before(60 * 24), NOW)).toBe("1 d ago");
    expect(ago(before(60 * 24 * 9), NOW)).toBe("9 d ago");
  });

  it("does not count backwards when the service's clock is ahead of the browser's", () => {
    expect(ago(before(-3), NOW)).toBe("just now");
  });
});
