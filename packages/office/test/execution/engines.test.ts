import { mkdtemp, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ClaudeEngine,
  CodexEngine,
  claudeArgs,
  codexArgs,
  parseClaude,
  parseCodexEvents,
  toEngineSchema,
  type EngineRequest,
} from "../../src/execution";
import type { Exec, ExecResult } from "../../src/kernel/process";

const base: EngineRequest = { prompt: "hello", cwd: "/work", access: "read", timeoutMs: 1000 };

const flagValue = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

const fixture = (name: string) => readFile(path.join(import.meta.dirname, "fixtures", name), "utf8");

const execReturning = (result: Partial<ExecResult>): Exec => async () => ({ stdout: "", stderr: "", code: 0, ...result });

describe("claude arguments", () => {
  it("gives a read-only run only the read tools and no shell", () => {
    const args = claudeArgs(base);
    expect(flagValue(args, "--tools")).toBe("Read,Grep,Glob");
    expect(args).toContain("--restricted");
    expect(args.join(" ")).not.toContain("Bash");
  });

  it("gives a writing run the edit tools plus exactly the allowed commands", () => {
    const args = claudeArgs({ ...base, access: "write", allowedCommands: ["npm test", "git diff *"] });
    expect(flagValue(args, "--tools")).toBe("Read,Edit,Write,Grep,Glob,Bash");
    expect(flagValue(args, "--allowedTools")).toBe("Read Edit Write Grep Glob Bash(npm test) Bash(git diff *)");
  });

  it("gives a writing run no shell when no command is allowed", () => {
    expect(flagValue(claudeArgs({ ...base, access: "write" }), "--tools")).toBe("Read,Edit,Write,Grep,Glob");
  });

  it("passes the schema, model and budget only when given", () => {
    expect(claudeArgs(base)).not.toContain("--json-schema");
    const args = claudeArgs({ ...base, schema: { type: "object" }, model: "sonnet", maxUsd: 2 });
    expect([flagValue(args, "--json-schema"), flagValue(args, "--model"), flagValue(args, "--max-budget-usd")]).toEqual([
      '{"type":"object"}',
      "sonnet",
      "2",
    ]);
  });
});

describe("claude output", () => {
  it("reads text, structured output, cost and model", () => {
    const stdout = JSON.stringify({
      subtype: "success",
      result: "done",
      structured_output: { a: 1 },
      total_cost_usd: 0.12,
      num_turns: 3,
      modelUsage: { "claude-sonnet": {} },
    });
    expect(parseClaude(stdout)).toEqual({
      ok: true,
      value: { text: "done", structured: { a: 1 }, costUsd: 0.12, turns: 3, model: "claude-sonnet" },
    });
  });

  it("reports no cost when the result names none, and keeps a cost of zero when it names one", () => {
    const unpriced = parseClaude(JSON.stringify({ subtype: "success", result: "done" }));
    const free = parseClaude(JSON.stringify({ subtype: "success", result: "done", total_cost_usd: 0 }));

    expect(unpriced).toMatchObject({ ok: true, value: { costUsd: null } });
    expect(free).toMatchObject({ ok: true, value: { costUsd: 0 } });
  });

  it("names the model that did the work, not the auxiliary one listed first", () => {
    const stdout = JSON.stringify({
      subtype: "success",
      modelUsage: { "claude-haiku": { costUSD: 0.0001 }, "claude-sonnet": { costUSD: 0.028 } },
    });
    expect(parseClaude(stdout)).toMatchObject({ ok: true, value: { model: "claude-sonnet" } });
  });

  it("counts cache writes and reads into the input tokens of a real result", async () => {
    expect(parseClaude(await fixture("claude-result.json"))).toEqual({
      ok: true,
      value: {
        text: "ok",
        structured: undefined,
        costUsd: 0.00100628,
        turns: 1,
        model: "claude-haiku-5-5",
        usage: { inputTokens: 7391, outputTokens: 4, cachedInputTokens: 3148 },
      },
    });
  });

  it("reports no usage when the result has none, and no cached tokens when only those are missing", () => {
    const silent = parseClaude(JSON.stringify({ subtype: "success", result: "done" }));
    const uncached = parseClaude(JSON.stringify({ subtype: "success", usage: { input_tokens: 10, output_tokens: 2 } }));

    expect(silent.ok && "usage" in silent.value).toBe(false);
    expect(uncached).toMatchObject({ ok: true, value: { usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: null } } });
  });

  it("keeps the tokens a run used when it ends in an error", () => {
    const usage = { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 900, output_tokens: 40 };
    const stdout = JSON.stringify({ is_error: true, subtype: "error_max_turns", usage });

    expect(parseClaude(stdout)).toMatchObject({ ok: false, error: { usage: { inputTokens: 905, outputTokens: 40, cachedInputTokens: 900 } } });
  });

  it("keeps what a run cost when it ends in an error", () => {
    const stdout = JSON.stringify({ is_error: true, subtype: "error_max_budget_usd", total_cost_usd: 3.02 });

    expect(parseClaude(stdout)).toMatchObject({ ok: false, error: { kind: "failed", costUsd: 3.02 } });
  });

  it("turns a stopped run and non-JSON output into failures", () => {
    expect(parseClaude(JSON.stringify({ is_error: true, subtype: "error_max_budget_usd" }))).toMatchObject({ ok: false });
    expect(parseClaude("Segmentation fault")).toMatchObject({ ok: false, error: { kind: "failed" } });
  });
});

describe("claude engine", () => {
  it("reports a timeout as a timeout", async () => {
    const engine = new ClaudeEngine(execReturning({ code: 124 }));
    expect(await engine.run(base)).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("reports a stopped run as cancelled, not as a failure or a timeout", async () => {
    const engine = new ClaudeEngine(execReturning({ code: 125 }));
    expect(await engine.run(base)).toMatchObject({ ok: false, error: { kind: "cancelled" } });
  });

  it("hands the signal to the process it starts", async () => {
    const stop = new AbortController();
    let seen: AbortSignal | undefined;
    const engine = new ClaudeEngine(async (_command, _args, options) => {
      seen = options?.signal;
      return { stdout: "", stderr: "", code: 125 };
    });

    await engine.run({ ...base, signal: stop.signal });

    expect(seen).toBe(stop.signal);
  });

  it("reports empty output with the exit code and stderr", async () => {
    const engine = new ClaudeEngine(execReturning({ code: 1, stderr: "not logged in" }));
    expect(await engine.run(base)).toMatchObject({ ok: false, error: { message: expect.stringContaining("not logged in") } });
  });

  it("checks the login without sending a prompt", async () => {
    expect(await new ClaudeEngine(execReturning({ stdout: '{"loggedIn":true}' })).loginStatus()).toMatchObject({ loggedIn: true });
    expect(await new ClaudeEngine(execReturning({ stdout: '{"loggedIn":false}' })).loginStatus()).toMatchObject({ loggedIn: false });
    const missing: Exec = async () => {
      throw new Error("ENOENT");
    };
    expect(await new ClaudeEngine(missing).loginStatus()).toMatchObject({ loggedIn: false });
  });
});

describe("codex arguments", () => {
  const files = { out: "/tmp/out.txt" };

  it("uses the read-only sandbox for read access and workspace-write for write access", () => {
    expect(flagValue(codexArgs(base, files), "-s")).toBe("read-only");
    expect(flagValue(codexArgs({ ...base, access: "write" }, files), "-s")).toBe("workspace-write");
  });

  it("ignores the user's config and rules and reads the prompt from stdin", () => {
    const args = codexArgs(base, files);
    expect(args).toEqual(expect.arrayContaining(["--ignore-user-config", "--ignore-rules", "--ephemeral", "--json"]));
    expect(args.at(-1)).toBe("-");
  });

  it("adds the output schema only when there is one", () => {
    expect(codexArgs(base, files)).not.toContain("--output-schema");
    expect(flagValue(codexArgs(base, { ...files, schema: "/tmp/s.json" }), "--output-schema")).toBe("/tmp/s.json");
  });
});

describe("codex events", () => {
  it("reads the turn and its tokens from a real run, where the input already counts the cached part", async () => {
    expect(parseCodexEvents(await fixture("codex-exec.jsonl"))).toEqual({
      turns: 1,
      usage: { inputTokens: 14210, outputTokens: 5, cachedInputTokens: 8064 },
    });
  });

  it("adds up the turns and skips lines that are not events", async () => {
    const events = await fixture("codex-exec.jsonl");
    const second = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } });

    expect(parseCodexEvents(`warning: slow network\n${events}{"type":"turn.comp\nnull\n${second}\n`)).toEqual({
      turns: 2,
      usage: { inputTokens: 14310, outputTokens: 12, cachedInputTokens: 8104 },
    });
  });

  it("reports no usage when no turn completed or the turn carries none", () => {
    expect(parseCodexEvents('{"type":"turn.started"}\n')).toEqual({ turns: 0, usage: null });
    expect(parseCodexEvents('{"type":"turn.completed"}\n')).toEqual({ turns: 1, usage: null });
  });
});

describe("codex engine", () => {
  let realHome: string;
  const previousHome = process.env.CODEX_HOME;

  beforeEach(async () => {
    realHome = await mkdtemp(path.join(tmpdir(), "skynot-codex-home-"));
    await writeFile(path.join(realHome, "auth.json"), "{}");
    await writeFile(path.join(realHome, "config.toml"), "personal = true");
    process.env.CODEX_HOME = realHome;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    await rm(realHome, { recursive: true, force: true });
  });

  it("answers with the last message and runs with a home that holds only the login", async () => {
    let homeSeen: { dir: string; files: string[]; authTarget: string } | undefined;
    const execute: Exec = async (_command, args, options) => {
      const dir = options!.env!.CODEX_HOME!;
      homeSeen = { dir, files: await readdir(dir), authTarget: await readlink(path.join(dir, "auth.json")) };
      await writeFile(flagValue(args, "-o")!, '{"verdict":"ok"}');
      return { stdout: await fixture("codex-exec.jsonl"), stderr: "", code: 0 };
    };

    const result = await new CodexEngine(execute).run({ ...base, schema: { type: "object" } });

    expect(result).toEqual({
      ok: true,
      value: {
        text: '{"verdict":"ok"}',
        structured: { verdict: "ok" },
        costUsd: null,
        turns: 1,
        model: "codex",
        usage: { inputTokens: 14210, outputTokens: 5, cachedInputTokens: 8064 },
      },
    });
    expect(homeSeen?.dir).not.toBe(realHome);
    expect(homeSeen?.files).toEqual(["auth.json"]);
    expect(homeSeen?.authTarget).toBe(path.join(realHome, "auth.json"));
  });

  it("names the model the role asked for, and carries no usage when the CLI printed no events", async () => {
    const execute: Exec = async (_command, args) => {
      await writeFile(flagValue(args, "-o")!, "text");
      return { stdout: "", stderr: "", code: 0 };
    };

    const result = await new CodexEngine(execute).run({ ...base, model: "gpt-test" });

    expect(result).toEqual({ ok: true, value: { text: "text", structured: undefined, costUsd: null, turns: 0, model: "gpt-test" } });
    expect(result.ok && "usage" in result.value).toBe(false);
  });

  it("keeps the tokens of a run that failed, and says what the events said when stderr is empty", async () => {
    const stdout = await fixture("codex-exec.jsonl");

    const result = await new CodexEngine(execReturning({ code: 1, stdout })).run(base);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "failed", message: expect.stringContaining("turn.completed"), usage: { inputTokens: 14210, outputTokens: 5, cachedInputTokens: 8064 } },
    });
  });

  it("removes its temporary home afterwards", async () => {
    let dir = "";
    const execute: Exec = async (_command, args, options) => {
      dir = path.dirname(options!.env!.CODEX_HOME!);
      await writeFile(flagValue(args, "-o")!, "text");
      return { stdout: "", stderr: "", code: 0 };
    };

    await new CodexEngine(execute).run(base);

    await expect(readdir(dir)).rejects.toThrow();
  });

  it("fails when the CLI exits non-zero or writes nothing", async () => {
    expect(await new CodexEngine(execReturning({ code: 1, stderr: "boom" })).run(base)).toMatchObject({ ok: false, error: { kind: "failed" } });
    expect(await new CodexEngine(execReturning({ code: 124 })).run(base)).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("checks the login from the CLI's own status command", async () => {
    expect(await new CodexEngine(execReturning({ stdout: "Logged in using ChatGPT" })).loginStatus()).toMatchObject({ loggedIn: true });
    expect(await new CodexEngine(execReturning({ stderr: "Logged in using ChatGPT" })).loginStatus()).toMatchObject({ loggedIn: true });
    expect(await new CodexEngine(execReturning({ code: 1, stdout: "Not logged in" })).loginStatus()).toMatchObject({ loggedIn: false });
  });
});

describe("engine schema", () => {
  it("drops the constraints strict structured output rejects and keeps the structure", () => {
    const schema = toEngineSchema(z.object({ title: z.string().min(3).max(20), tags: z.array(z.string()).max(2), risk: z.enum(["low", "high"]) }));

    const text = JSON.stringify(schema);
    expect(text).not.toMatch(/minLength|maxLength|maxItems|\$schema/);
    expect(schema).toMatchObject({ type: "object", required: ["title", "tags", "risk"] });
    expect(text).toContain('"enum":["low","high"]');
  });
});
