import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeRoles, loadTeam, parseTeamFile } from "../../src/team";

const valid = `
version: 1
roles:
  manager: { engine: claude, model: claude-sonnet-5-5 }
  developer: { engine: codex }
`;

const withAdvisor = `${valid}advisors:
  architect:
    engine: claude
    description: how a change fits the code
    soul: roles/architect.md
`;

describe("team file", () => {
  it("reads the engine and the optional model of each role", () => {
    const team = parseTeamFile(valid);

    expect(team.ok && describeRoles(team.value)).toEqual([
      { role: "manager", engine: "claude", model: "claude-sonnet-5-5" },
      { role: "developer", engine: "codex", model: null },
    ]);
  });

  it("works without advisors and lists them after the roles when present", () => {
    const alone = parseTeamFile(valid);
    const advised = parseTeamFile(withAdvisor);

    expect(alone.ok && alone.value.advisors).toEqual({});
    expect(advised.ok && describeRoles(advised.value).map((entry) => entry.role)).toEqual(["manager", "developer", "architect"]);
  });

  it.each([
    ["an unknown engine", valid.replace("codex", "gemini"), "roles.developer.engine"],
    ["a role that does not exist", `${valid}  architect: { engine: claude }\n`, "architect"],
    ["a misspelled field", valid.replace("model:", "modle:"), "modle"],
    ["a missing role", "version: 1\nroles:\n  manager: { engine: claude }\n", "roles.developer"],
    ["an empty model", valid.replace("claude-sonnet-5-5", '""'), "roles.manager.model"],
    ["a wrong version", valid.replace("version: 1", "version: 2"), "version"],
    ["an advisor without a soul", withAdvisor.replace("    soul: roles/architect.md\n", ""), "advisors.architect.soul"],
    ["an advisor without a description", withAdvisor.replace("    description: how a change fits the code\n", ""), "advisors.architect.description"],
    ["an advisor named like a role", withAdvisor.replace("architect:", "manager:"), '"manager" is already a role'],
    ["an advisor name with spaces", withAdvisor.replace("architect:", '"the architect":'), "advisors"],
  ])("rejects %s and names it", (_name, source, mention) => {
    const team = parseTeamFile(source);

    expect(team.ok).toBe(false);
    expect(!team.ok && team.error).toContain(mention);
  });

  it("rejects text that is not YAML", () => {
    const team = parseTeamFile("roles: [unclosed");

    expect(!team.ok && team.error).toContain("not valid YAML");
  });
});

describe("loading a team", () => {
  async function folder(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "skynot-team-"));
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), content);
    }
    return path.join(dir, "team.yaml");
  }

  it("reads each advisor's soul from the file next to the team file", async () => {
    const file = await folder({ "team.yaml": withAdvisor, "roles/architect.md": "  # Architect\nYou design.\n" });

    const team = await loadTeam(file);

    expect(team.ok && team.value.advisors.architect).toMatchObject({ engine: "claude", description: "how a change fits the code", soul: "# Architect\nYou design." });
  });

  it("names the advisor and the file when a soul is missing or empty", async () => {
    const missing = await loadTeam(await folder({ "team.yaml": withAdvisor }));
    const empty = await loadTeam(await folder({ "team.yaml": withAdvisor, "roles/architect.md": "  \n" }));

    expect(!missing.ok && missing.error).toContain('the soul of "architect" (roles/architect.md)');
    expect(!empty.ok && empty.error).toContain("is empty");
  });

  it("accepts the tracked example together with the tracked souls", async () => {
    const team = await loadTeam("team.example.yaml");

    expect(team.ok && Object.keys(team.value.advisors)).toEqual(["architect", "reviewer"]);
    expect((await readFile("team.example.yaml", "utf8")).includes("advisors:")).toBe(true);
  });
});
