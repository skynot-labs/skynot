import { config, defaultAvatar } from "../config";
import type { Agent, AgentStatus, Command, Project, ProjectSummary, ShopState, Snapshot } from "../contracts";

const DEV_COMMANDS: ReadonlySet<Command["name"]> = new Set(["merge-pull-request"]);
const DEBOUNCE_MS = 60;

export function mapState(state: ShopState, accents: readonly string[] = config.accents): Snapshot {
  const accentAt = (index: number) => accents[Math.max(index, 0) % accents.length] ?? "";
  const projects: ProjectSummary[] = state.projects.map((summary, index) => ({ ...summary, name: nameOf(summary.repo), accent: accentAt(index) }));
  const project: Project = {
    id: state.project.id,
    name: nameOf(state.project.repo),
    repo: state.project.repo,
    accent: accentAt(state.projects.findIndex((summary) => summary.id === state.project.id)),
    reviewing: state.reviewing,
    workers: state.workers,
    agents: state.team.map((member, index) => agentOf(state, member, index)),
    orders: state.orders,
    inbox: state.inbox,
    chat: state.chat,
    decisions: state.decisions,
    teamChanges: state.teamChanges,
    briefingChanges: state.briefingChanges,
    briefing: state.briefing,
    hireable: state.hireable,
    activity: state.activity,
    spentUsd: state.costs.project,
  };
  return {
    project,
    projects,
    paused: state.paused,
    readiness: state.readiness,
    costs: { today: state.costs.today, total: state.costs.total, cap: state.costs.cap },
    cursor: state.cursor,
    simulated: state.simulated,
  };
}

function nameOf(repo: string): string {
  return repo.split("/").at(-1) || repo;
}

function agentOf(state: ShopState, member: ShopState["team"][number], index: number): Agent {
  const { role } = member;
  const label = role.replace(/[_-]/g, " ");
  const running = state.presence.working.find((run) => run.role === role);
  const queued = state.presence.waiting.find((run) => run.role === role);
  const asked = state.inbox.find((item) => (role === "manager" ? item.kind !== "worker_question" : item.kind === "worker_question" && item.from === role));
  const status: AgentStatus = running ? "working" : queued ? "queued" : asked ? "waiting-director" : "idle";
  const live = running ?? queued;
  return {
    id: role,
    name: member.name ?? label,
    role: label,
    kind: kindOf(state, role),
    engine: member.engine,
    model: member.model,
    status,
    orderId: live ? live.orderId : (asked?.orderId ?? null),
    runId: live?.runId ?? null,
    queuePosition: running ? null : (queued?.position ?? null),
    avatar: defaultAvatar(index),
  };
}

function kindOf(state: ShopState, role: string): Agent["kind"] {
  if (role === "manager") return "manager";
  const doesOrders = state.workers.includes(role) || role === "developer" || state.orders.some((order) => order.worker === role);
  return doesOrders ? "worker" : "advisor";
}

export class HttpGateway {
  private cursor = 0;

  constructor(private readonly base = "/api") {
    if (!base.startsWith("/") || base.startsWith("//")) throw new Error("Use a same-origin API path.");
  }

  async read(projectId?: string): Promise<Snapshot> {
    const response = await this.get(projectId);
    const snapshot = mapState((await response.json()) as ShopState);
    this.cursor = Math.max(this.cursor, snapshot.cursor);
    return snapshot;
  }

  async send(command: Command): Promise<void> {
    const scope = DEV_COMMANDS.has(command.name) ? "dev" : "commands";
    const response = await fetch(`${this.base}/${scope}/${command.name}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command.payload),
    });
    if (!response.ok) throw new Error(await errorOf(response, `The shop refused the command (${response.status}).`));
  }

  watch(onChange: () => void, onConnection: (connected: boolean) => void): () => void {
    const source = new EventSource(`${this.base}/events?after=${this.cursor}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seen = this.cursor;
    source.onopen = () => {
      onConnection(true);
      onChange();
    };
    source.onerror = () => onConnection(false);
    source.onmessage = (event) => {
      const sequence = sequenceOf(event.data);
      if (sequence === null || sequence <= seen) return;
      seen = sequence;
      clearTimeout(timer);
      timer = setTimeout(onChange, DEBOUNCE_MS);
    };
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }

  // A remembered project the shop no longer has answers 404: the default project is read instead.
  private async get(projectId?: string): Promise<Response> {
    const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
    const response = await fetch(`${this.base}/state${query}`, { credentials: "same-origin" });
    if (response.ok) return response;
    if (response.status === 404 && projectId) return this.get();
    throw new Error(await errorOf(response, `The shop did not answer (${response.status}).`));
  }
}

async function errorOf(response: Response, fallback: string): Promise<string> {
  const detail: unknown = await response.json().catch(() => null);
  const message = typeof detail === "object" && detail !== null && "error" in detail ? detail.error : null;
  return typeof message === "string" ? message : fallback;
}

function sequenceOf(data: unknown): number | null {
  if (typeof data !== "string") return null;
  try {
    const event: unknown = JSON.parse(data);
    const sequence = typeof event === "object" && event !== null && "sequence" in event ? event.sequence : null;
    return typeof sequence === "number" && Number.isInteger(sequence) ? sequence : null;
  } catch {
    return null;
  }
}
