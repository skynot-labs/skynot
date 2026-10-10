import { err, ok, type Result } from "../../kernel";
import type { EventLog, Projection, StoredEvent } from "../../kernel/events";

export interface PauseState {
  readonly since: string;
  readonly reason: string;
}

// While paused the shop starts no new run; the ones in progress finish. The pause survives a restart.
export class ShopControl implements Projection {
  private state: PauseState | null = null;
  private lastCapDay: string | null = null;

  constructor(private readonly log: EventLog) {}

  apply(event: StoredEvent): void {
    if (event.type === "control.paused") {
      const { reason, capDay } = event.payload as { reason: string; capDay?: string };
      this.state = { since: event.occurredAt, reason };
      if (capDay) this.lastCapDay = capDay;
    }
    if (event.type === "control.resumed") this.state = null;
  }

  paused(): PauseState | null {
    return this.state;
  }

  // The day the cost cap last paused the shop, so a resume on that day is not undone by the same cap.
  capDay(): string | null {
    return this.lastCapDay;
  }

  async pause(reason: string, capDay?: string): Promise<Result<PauseState, string>> {
    if (this.state) return err("the shop is already paused");
    await this.log.record([{ type: "control.paused", payload: { reason, ...(capDay && { capDay }) } }]);
    return ok(this.state!);
  }

  async resume(): Promise<Result<null, string>> {
    if (!this.state) return err("the shop is not paused");
    await this.log.record([{ type: "control.resumed", payload: {} }]);
    return ok(null);
  }
}
