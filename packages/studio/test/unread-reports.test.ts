import { describe, expect, it } from "vitest";
import type { Report } from "../src/contracts";
import { unreadReports } from "../src/application/unread-reports";

const reports = (...days: number[]) => days.map((day) => ({ id: `r${day}`, at: `2026-10-${day}T09:00:00.000Z` })) as unknown as Report[];

describe("the reports the director has not read", () => {
  it("counts the ones written after the newest one seen", () => {
    expect(unreadReports(reports(15, 14, 13), "2026-10-13T09:00:00.000Z")).toBe(2);
    expect(unreadReports(reports(15, 14, 13), "2026-10-15T09:00:00.000Z")).toBe(0);
  });

  it("counts every report once the director has opened an empty list", () => {
    expect(unreadReports(reports(15, 14), "")).toBe(2);
  });

  it("counts nothing for a project met for the first time", () => {
    expect(unreadReports(reports(15, 14), null)).toBe(0);
  });
});
