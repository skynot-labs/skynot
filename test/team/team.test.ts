import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { describeRoles, parseTeam } from "../../src/team";

const valid = `
version: 1
roles:
  manager: { engine: claude, model: claude-sonnet-5-5 }
  developer: { engine: codex }
`;

describe("team", () => {
  it("reads the engine and the optional model of each role", () => {
    const team = parseTeam(valid);

    expect(team.ok && describeRoles(team.value)).toEqual([
      { role: "manager", engine: "claude", model: "claude-sonnet-5-5" },
      { role: "developer", engine: "codex", model: null },
    ]);
  });

  it("accepts the tracked example", async () => {
    expect(parseTeam(await readFile("team.example.yaml", "utf8")).ok).toBe(true);
  });

  it.each([
    ["an unknown engine", valid.replace("codex", "gemini"), "roles.developer.engine"],
    ["a role that does not exist yet", `${valid}  architect: { engine: claude }\n`, "architect"],
    ["a misspelled field", valid.replace("model:", "modle:"), "modle"],
    ["a missing role", "version: 1\nroles:\n  manager: { engine: claude }\n", "roles.developer"],
    ["an empty model", valid.replace("claude-sonnet-5-5", '""'), "roles.manager.model"],
    ["a wrong version", valid.replace("version: 1", "version: 2"), "version"],
  ])("rejects %s and names it", (_name, source, mention) => {
    const team = parseTeam(source);

    expect(team.ok).toBe(false);
    expect(!team.ok && team.error).toContain(mention);
  });

  it("rejects text that is not YAML", () => {
    const team = parseTeam("roles: [unclosed");

    expect(!team.ok && team.error).toContain("not valid YAML");
  });
});
