import { err, ok, type Result } from "../../kernel";
import type { EngineFailure, EngineRequest, EngineResult, LoginStatus, RoleEngine, TokenUsage } from "../domain";
import { CANCELLED, TIMED_OUT, exec, type Exec } from "../../kernel/process";

const READ_TOOLS = ["Read", "Grep", "Glob"];
const WRITE_TOOLS = ["Read", "Edit", "Write", "Grep", "Glob"];

export function claudeArgs(request: EngineRequest): string[] {
  const commands = (request.allowedCommands ?? []).map((command) => `Bash(${command})`);
  const writing = request.access === "write";
  const tools = writing ? [...WRITE_TOOLS, ...(commands.length ? ["Bash"] : [])] : READ_TOOLS;

  return [
    "-p",
    "--output-format", "json",
    "--no-session-persistence",
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--tools", tools.join(","),
    "--allowedTools", [...tools.filter((tool) => tool !== "Bash"), ...commands].join(" "),
    ...(request.system ? ["--append-system-prompt", request.system] : []),
    ...(request.schema ? ["--json-schema", JSON.stringify(request.schema)] : []),
    ...(request.model ? ["--model", request.model] : []),
    ...(request.maxUsd ? ["--max-budget-usd", String(request.maxUsd)] : []),
  ];
}

interface ClaudeJson {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, { costUSD?: number }>;
}

// The CLI also calls a small auxiliary model, and lists it first; the one that did the work cost the most.
function dominantModel(usage: ClaudeJson["modelUsage"] = {}): string {
  const [name] = Object.entries(usage).sort(([, a], [, b]) => (b.costUSD ?? 0) - (a.costUSD ?? 0))[0] ?? [];
  return name ?? "claude";
}

// The CLI's input_tokens leaves out what was written to or read from the cache.
function usageOf(usage: ClaudeJson["usage"]): TokenUsage | undefined {
  if (usage?.input_tokens === undefined || usage.output_tokens === undefined) return undefined;
  return {
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? null,
  };
}

export function parseClaude(stdout: string): Result<EngineResult, EngineFailure> {
  let json: ClaudeJson;
  try {
    json = JSON.parse(stdout) as ClaudeJson;
  } catch {
    return err({ kind: "failed", message: `claude printed something that is not JSON: ${stdout.slice(0, 200)}` });
  }
  const usage = usageOf(json.usage);
  if (json.is_error || (json.subtype && json.subtype !== "success")) {
    return err({
      kind: "failed",
      message: `claude stopped: ${json.subtype ?? "error"} ${json.result ?? ""}`.trim(),
      ...(json.total_cost_usd !== undefined && { costUsd: json.total_cost_usd }),
      ...(usage && { usage }),
    });
  }
  return ok({
    text: json.result ?? "",
    structured: json.structured_output,
    costUsd: json.total_cost_usd ?? null,
    turns: json.num_turns ?? 0,
    model: dominantModel(json.modelUsage),
    ...(usage && { usage }),
  });
}

export class ClaudeEngine implements RoleEngine {
  constructor(private readonly execute: Exec = exec) {}

  async run(request: EngineRequest): Promise<Result<EngineResult, EngineFailure>> {
    const result = await this.execute("claude", claudeArgs(request), {
      cwd: request.cwd,
      input: request.prompt,
      timeoutMs: request.timeoutMs,
      ...(request.signal && { signal: request.signal }),
    });
    if (result.code === CANCELLED) return err({ kind: "cancelled", message: "claude was stopped" });
    if (result.code === TIMED_OUT) return err({ kind: "timeout", message: "claude timed out" });
    if (!result.stdout.trim()) {
      return err({ kind: "failed", message: `claude failed (${result.code}): ${result.stderr.trim().slice(-400)}` });
    }
    return parseClaude(result.stdout);
  }

  async loginStatus(): Promise<LoginStatus> {
    try {
      const { stdout } = await this.execute("claude", ["auth", "status"]);
      const status = JSON.parse(stdout) as { loggedIn?: boolean };
      return status.loggedIn ? { loggedIn: true, detail: "logged in" } : { loggedIn: false, detail: "run `claude auth login`" };
    } catch {
      return { loggedIn: false, detail: "claude is not installed or did not answer" };
    }
  }
}
