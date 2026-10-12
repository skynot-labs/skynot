import { err, ok, type Result } from "../../kernel";
import type { EngineFailure, EngineRequest, EngineResult, LoginStatus, RoleEngine } from "../domain";

export type FakeAnswer = (request: EngineRequest) => Partial<EngineResult> | EngineFailure | Promise<Partial<EngineResult> | EngineFailure>;

export class FakeEngine implements RoleEngine {
  readonly requests: EngineRequest[] = [];

  constructor(private readonly answer: FakeAnswer = () => ({ text: "ok" })) {}

  async run(request: EngineRequest): Promise<Result<EngineResult, EngineFailure>> {
    this.requests.push(request);
    const answer = await this.answer(request);
    if ("kind" in answer) return err(answer);
    return ok({ text: "", costUsd: null, turns: 1, model: "fake", ...answer });
  }

  async loginStatus(): Promise<LoginStatus> {
    return { loggedIn: true, detail: "fake" };
  }
}
