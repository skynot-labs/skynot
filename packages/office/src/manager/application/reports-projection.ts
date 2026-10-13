import { inScope, type Projection, type ProjectScope, type StoredEvent } from "../../kernel/events";
import { asManagerEvent, type ReportId } from "../domain";

export interface Report {
  readonly id: ReportId;
  readonly taskId: string;
  readonly title: string;
  readonly text: string;
  readonly at: string;
  // The director's message that asked for the task; absent for a task of the office's own.
  readonly requested: string | null;
}

// What the Manager wrote for a scheduled task: read later, never answered, so it stays out of the chat.
export class ReportsProjection implements Projection {
  private readonly reports: Report[] = [];

  constructor(private readonly scope?: ProjectScope) {}

  apply(stored: StoredEvent): void {
    const event = asManagerEvent(stored);
    if (event?.type !== "manager.reported" || !inScope(stored, this.scope)) return;
    const { reportId, taskId, title, text, requested } = event.payload;
    this.reports.push({ id: reportId, taskId, title, text, at: stored.occurredAt, requested: requested ?? null });
  }

  newestFirst(count: number): Report[] {
    return this.reports.slice(-count).reverse();
  }

  lastOf(taskId: string): Report | undefined {
    return this.reports.findLast((report) => report.taskId === taskId);
  }
}
