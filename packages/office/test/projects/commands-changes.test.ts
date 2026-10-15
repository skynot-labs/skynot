import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { err, fixedClock, ok } from "../../src/kernel";
import { attachProjection, EventLog, InMemoryEventStore } from "../../src/kernel/events";
import { CommandsChanges, CommandsService, parseProjectFile, writeProjectCommands, type ProjectCommands, type ProjectCommandsWriter } from "../../src/projects";

const PROJECT = `version: 1
# kept on this machine until there is something to publish
local: true
base_branch: main
setup_command: null
verify_commands: ["true"]
protected_paths: [".github/"]
`;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "skynot-commands-"));
  await mkdir(path.join(dir, "listo"));
  await writeFile(path.join(dir, "listo", "project.yaml"), PROJECT);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const tested: ProjectCommands = { setupCommand: "npm ci", verifyCommands: ["npm run typecheck", "npm test"] };

async function open(writer: ProjectCommandsWriter = { write: async (projectId, commands) => ((await writeProjectCommands(dir, projectId, commands)).ok ? ok(undefined) : err("no file")) }) {
  const log = new EventLog(new InMemoryEventStore(), fixedClock(new Date("2026-10-15T12:00:00.000Z")));
  const changes = new CommandsChanges();
  await attachProjection(log, changes);
  return { service: new CommandsService(log, changes, writer), changes };
}

const projectFile = () => readFile(path.join(dir, "listo", "project.yaml"), "utf8");

describe("a change of a project's commands", () => {
  it("writes nothing until the director signs, then writes both commands into project.yaml and keeps the rest of it", async () => {
    const { service, changes } = await open();
    const proposed = await service.propose("listo", tested, "the first order added tests");
    if (!proposed.ok) throw new Error(proposed.error.message);

    expect(await projectFile()).toBe(PROJECT);
    expect(changes.pendingFor("listo")).toHaveLength(1);

    expect((await service.sign(proposed.value.id)).ok).toBe(true);

    const written = await projectFile();
    expect(written).toContain("# kept on this machine until there is something to publish");
    expect(parseProjectFile("listo", written)).toMatchObject({ ok: true, value: { local: true, setupCommand: "npm ci", verifyCommands: ["npm run typecheck", "npm test"], protectedPaths: [".github/"] } });
    expect(changes.pendingFor("listo")).toEqual([]);
  });

  it("changes nothing when the director discards it", async () => {
    const { service } = await open();
    const proposed = await service.propose("listo", tested, "the first order added tests");
    if (!proposed.ok) throw new Error(proposed.error.message);

    await service.discard(proposed.value.id);

    expect(await projectFile()).toBe(PROJECT);
    expect(await service.sign(proposed.value.id)).toMatchObject({ ok: false, error: { kind: "invalid" } });
  });

  it("refuses commands that would leave the project with nothing to verify, and a second proposal while one waits", async () => {
    const { service } = await open();

    expect(await service.propose("listo", { setupCommand: null, verifyCommands: [] }, "nothing to run")).toMatchObject({ ok: false, error: { message: expect.stringContaining("at least one verify command") } });
    expect(await service.propose("listo", { setupCommand: null, verifyCommands: ["  "] }, "blank")).toMatchObject({ ok: false });
    await service.propose("listo", tested, "the first order added tests");
    expect(await service.propose("listo", tested, "again")).toMatchObject({ ok: false, error: { message: expect.stringContaining("already") } });
  });

  it("is not signed when project.yaml cannot be written, and stays waiting", async () => {
    const { service, changes } = await open({ write: async () => err("project.yaml is not there") });
    const proposed = await service.propose("blog", tested, "the first order added tests");
    if (!proposed.ok) throw new Error(proposed.error.message);

    expect(await service.sign(proposed.value.id)).toMatchObject({ ok: false, error: { message: "project.yaml is not there" } });
    expect(changes.pendingFor("blog")).toHaveLength(1);
  });

  it("refuses to write the commands of a project with no folder", async () => {
    expect(await writeProjectCommands(dir, "blog", tested)).toMatchObject({ ok: false, error: expect.stringContaining("policy.yaml") });
  });
});
