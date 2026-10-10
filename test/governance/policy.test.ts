import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePolicy } from "../../src/governance";

const example = readFileSync("policy.example.yaml", "utf8");

describe("policy parsing", () => {
  it("accepts the shipped example once the placeholder repo is replaced", () => {
    const parsed = parsePolicy(example.replace("OWNER/REPO", "acme/widgets"));
    expect(parsed).toMatchObject({ ok: true, value: { repos: [{ name: "acme/widgets" }] } });
  });

  it("reads the optional daily cost cap and refuses one that is not a positive number", () => {
    const withCap = (value: string) => parsePolicy(example.replace("OWNER/REPO", "acme/widgets").replace(/max_usd_per_day: .*/, `max_usd_per_day: ${value}`));
    const without = parsePolicy(example.replace("OWNER/REPO", "acme/widgets").replace(/  max_usd_per_day: .*\n/, ""));

    expect(withCap("7.5")).toMatchObject({ ok: true, value: { run_budget: { max_usd_per_day: 7.5 } } });
    expect(without).toMatchObject({ ok: true });
    expect(without.ok && without.value.run_budget.max_usd_per_day).toBeUndefined();
    expect(withCap("0").ok).toBe(false);
    expect(withCap("-3").ok).toBe(false);
  });

  it("keeps the placeholder repo parseable, since a project's own file says which repository it works on", () => {
    expect(parsePolicy(example).ok).toBe(true);
  });

  it("rejects a trigger label outside the label prefix", () => {
    const source = example.replace("OWNER/REPO", "a/b").replace('trigger: "taller:implement"', 'trigger: "go"');
    expect(parsePolicy(source)).toMatchObject({ ok: false, error: expect.stringContaining("labels.trigger") });
  });

  it("rejects the same repo listed twice", () => {
    const duplicated = example
      .replace("OWNER/REPO", "a/b")
      .replace(
        "repos:\n",
        'repos:\n  - name: a/b\n    base_branch: main\n    setup_command: null\n    verify_commands: ["npm test"]\n    protected_paths: []\n',
      );
    expect(parsePolicy(duplicated)).toMatchObject({ ok: false, error: expect.stringContaining("listed twice") });
  });

  it("rejects a parallelism limit of zero", () => {
    const source = example.replace("OWNER/REPO", "a/b").replace("max_parallel: 4", "max_parallel: 0");
    expect(parsePolicy(source)).toMatchObject({ ok: false, error: expect.stringContaining("limits.max_parallel") });
  });

  it("reports malformed YAML instead of throwing", () => {
    expect(parsePolicy("repos: [unclosed")).toMatchObject({ ok: false, error: expect.stringContaining("not valid YAML") });
  });
});
