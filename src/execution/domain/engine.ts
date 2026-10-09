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
}

export interface EngineResult {
  text: string;
  structured?: unknown;
  costUsd: number;
  turns: number;
  model: string;
}

export interface EngineFailure {
  readonly kind: "timeout" | "failed" | "engine_unavailable";
  readonly message: string;
}

export interface LoginStatus {
  readonly loggedIn: boolean;
  readonly detail: string;
}

export interface RoleEngine {
  run(request: EngineRequest): Promise<Result<EngineResult, EngineFailure>>;
  loginStatus(): Promise<LoginStatus>;
}
