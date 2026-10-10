import type { DomainEvent, StoredEvent } from "./event";

export interface EventRecorder {
  record(events: readonly DomainEvent[]): Promise<StoredEvent[]>;
}

// What a project's services record carries the project, so projections can tell whose event it is.
export function inProject(log: EventRecorder, projectId: string): EventRecorder {
  return { record: (events) => log.record(events.map((event) => ({ ...event, payload: { ...(event.payload as object), projectId } }))) };
}

// Events written before projects existed carry none; they belong to the first project.
export function projectOfEvent(event: { payload: unknown }, firstProject: string): string {
  const { projectId } = event.payload as { projectId?: unknown };
  return typeof projectId === "string" ? projectId : firstProject;
}

export interface ProjectScope {
  readonly id: string;
  readonly isFirst: boolean;
}

export function inScope(event: { payload: unknown }, scope: ProjectScope | undefined): boolean {
  if (!scope) return true;
  const { projectId } = event.payload as { projectId?: unknown };
  return typeof projectId === "string" ? projectId === scope.id : scope.isFirst;
}
