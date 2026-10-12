import { PauseStateSchema } from "@skynot/contract";
import { describe, expect, it } from "vitest";
import { pausedByDirector } from "../src/application/pause";

const since = "2026-10-11T09:00:00.000Z";

describe("who paused the shop", () => {
  it("believes what the office says, whatever the reason reads", () => {
    expect(pausedByDirector({ since, reason: "going home for the day", by: "director" })).toBe(true);
    expect(pausedByDirector({ since, reason: "paused by the director", by: "cost_cap" })).toBe(false);
  });

  it("reads the reason of an office that does not say who paused", () => {
    const fromAnOlderOffice = (reason: string) => PauseStateSchema.parse({ since, reason });

    expect(pausedByDirector(fromAnOlderOffice("paused by the director"))).toBe(true);
    expect(pausedByDirector(fromAnOlderOffice("the daily cost cap of $10.00 was reached ($10.02 spent)"))).toBe(false);
  });

  it("reads the reason when a later office names a pauser this studio does not know", () => {
    const fromALaterOffice = (reason: string) => PauseStateSchema.parse({ since, reason, by: "the landlord" });

    expect(fromALaterOffice("maintenance").by).toBeUndefined();
    expect(pausedByDirector(fromALaterOffice("maintenance"))).toBe(false);
    expect(pausedByDirector(fromALaterOffice("paused by the director"))).toBe(true);
  });
});
