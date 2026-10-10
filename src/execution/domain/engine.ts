import type { Result } from "../../kernel";

export type EngineName = "claude" | "codex";

export type Access = "read" | "write";

export interface EngineRequest {
  prompt: string;
  system?: string;
  cwd: string;
  access: Access;
  schema?: object;
  model?: string;
  maxUsd?: number;
  timeoutMs: number;
  allowedCommands?: string[];
  signal?: AbortSignal;
}

// inputTokens is the whole input, cached part included.
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number | null;
}

export function sumUsage(usages: readonly TokenUsage[]): TokenUsage | null {
  if (usages.length === 0) return null;
  const cached = usages.flatMap((usage) => (usage.cachedInputTokens === null ? [] : [usage.cachedInputTokens]));
  return {
    inputTokens: usages.reduce((total, usage) => total + usage.inputTokens, 0),
    outputTokens: usages.reduce((total, usage) => total + usage.outputTokens, 0),
    cachedInputTokens: cached.length === 0 ? null : cached.reduce((total, tokens) => total + tokens, 0),
  };
}

export interface EngineResult {
  text: string;
  structured?: unknown;
  costUsd: number | null;
  turns: number;
  model: string;
  usage?: TokenUsage;
}

export interface EngineFailure {
  readonly kind: "timeout" | "failed" | "engine_unavailable" | "cancelled" | "interrupted";
  readonly message: string;
  readonly costUsd?: number;
  readonly usage?: TokenUsage;
}

export interface LoginStatus {
  readonly loggedIn: boolean;
  readonly detail: string;
}

export interface RoleEngine {
  run(request: EngineRequest): Promise<Result<EngineResult, EngineFailure>>;
  loginStatus(): Promise<LoginStatus>;
}
