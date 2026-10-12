import type { Connection } from "../application/connection";
import { config, defaultAvatar } from "../config";
import type { Agent, AgentStatus, Command, Project, ProjectSummary, ShopState, Snapshot } from "../contracts";

const DEV_COMMANDS: ReadonlySet<Command["name"]> = new Set(["merge-pull-request"]);
const DEBOUNCE_MS = 60;
const RECONNECT_MS = 2000;

export function mapState(state: ShopState, accents: readonly string[] = config.accents): Snapshot {
  const accentAt = (index: number) => accents[Math.max(index, 0) % accents.length] ?? "";
  const projects: ProjectSummary[] = state.projects.map((summary, index) => ({ ...summary, name: summary.name || nameOf(summary.repo), accent: accentAt(index) }));
  const current = state.projects.findIndex((summary) => summary.id === state.project.id);
  const project: Project = {
    id: state.project.id,
    name: state.project.name || nameOf(state.project.repo),
    description: state.project.description,
    repo: state.project.repo,
    accent: accentAt(current),
    paused: state.projectPaused,
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
    runs: state.runs,
    answered: state.answered,
    spentUsd: state.costs.project,
    tokens: state.costs.tokens,
    needsYou: state.projects[current]?.needsYou ?? 0,
  };
  return {
    project,
    projects,
    paused: state.paused,
    readiness: state.readiness,
    costs: { today: state.costs.today, total: state.costs.total, cap: state.costs.cap, days: state.costs.days ?? [] },
    preferences: state.preferences,
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
  const totals = state.agents.find((entry) => entry.role === role);
  const failed = totals?.lastOutcome === "failed";
  const status: AgentStatus = running ? "working" : queued ? "queued" : failed ? "error" : asked ? "waiting-director" : "idle";
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
    runs: totals?.runs ?? 0,
    spentUsd: totals?.spentUsd ?? null,
    usage: totals?.usage ?? null,
    soul: state.souls.find((soul) => soul.role === role) ?? null,
    instructions: state.instructions.find((entry) => entry.role === role)?.text ?? null,
    avatar: defaultAvatar(index),
  };
}

function kindOf(state: ShopState, role: string): Agent["kind"] {
  if (role === "manager") return "manager";
  const doesOrders = state.workers.includes(role) || role === "developer" || state.orders.some((order) => order.worker === role);
  return doesOrders ? "worker" : "advisor";
}

// The state is typed from the service's own code, so it only fails to map when the two were built from different versions.
function readSnapshot(state: unknown): Snapshot {
  try {
    return mapState(state as ShopState);
  } catch {
    throw new Error("The console and the service are different versions. Run `npm run build:console` and restart the service.");
  }
}

export class Unauthorized extends Error {}

export interface OfficeMeta {
  contract: number;
  requiresSession: boolean;
}

export class HttpGateway {
  private cursor = 0;
  private readonly base: string;

  // Without a connection it talks to the office that served this page; with one, to that office and with its session.
  constructor(
    private readonly connection?: Connection,
    private readonly onUnauthorized?: () => void,
  ) {
    this.base = connection ? `${connection.office}/api` : "/api";
  }

  async meta(): Promise<OfficeMeta> {
    const response = await this.request("/meta");
    const meta: unknown = response.ok ? await response.json().catch(() => null) : null;
    if (typeof meta !== "object" || meta === null || !("contract" in meta) || typeof meta.contract !== "number") {
      throw new Error(`The office did not say which contract it speaks (${response.status}).`);
    }
    return { contract: meta.contract, requiresSession: "requiresSession" in meta && meta.requiresSession === true };
  }

  async read(projectId?: string): Promise<Snapshot> {
    const response = await this.get(projectId);
    const snapshot = readSnapshot(await response.json());
    this.cursor = Math.max(this.cursor, snapshot.cursor);
    return snapshot;
  }

  async send(command: Command): Promise<void> {
    const scope = DEV_COMMANDS.has(command.name) ? "dev" : "commands";
    const response = await this.request(`/${scope}/${command.name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command.payload),
    });
    if (!response.ok) throw new Error(await errorOf(response, `The shop refused the command (${response.status}).`));
  }

  // EventSource cannot carry the session, so the stream is read from a plain request.
  watch(onChange: () => void, onConnection: (connected: boolean) => void): () => void {
    const stop = new AbortController();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let seen = this.cursor;

    const notice = (data: string) => {
      const sequence = sequenceOf(data);
      if (stop.signal.aborted || sequence === null || sequence <= seen) return;
      seen = sequence;
      clearTimeout(debounce);
      debounce = setTimeout(onChange, DEBOUNCE_MS);
    };
    const listen = async () => {
      try {
        const response = await this.request(`/events?after=${seen}`, { signal: stop.signal, headers: { accept: "text/event-stream" } });
        if (response.ok && response.body && !stop.signal.aborted) {
          onConnection(true);
          onChange();
          await readServerSentEvents(response.body, notice);
        }
      } catch (cause) {
        if (cause instanceof Unauthorized) return onConnection(false);
      }
      if (stop.signal.aborted) return;
      onConnection(false);
      retry = setTimeout(() => void listen(), RECONNECT_MS);
    };
    void listen();

    return () => {
      stop.abort();
      clearTimeout(debounce);
      clearTimeout(retry);
    };
  }

  // A remembered project the shop no longer has answers 404: the default project is read instead.
  private async get(projectId?: string): Promise<Response> {
    const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
    const response = await this.request(`/state${query}`);
    if (response.ok) return response;
    if (response.status === 404 && projectId) return this.get();
    throw new Error(await errorOf(response, `The shop did not answer (${response.status}).`));
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const session = this.connection && { authorization: `Bearer ${this.connection.token}` };
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      credentials: this.connection ? "omit" : "same-origin",
      headers: { ...init.headers, ...session },
    });
    if (response.status !== 401) return response;
    this.onUnauthorized?.();
    throw new Unauthorized(await errorOf(response, "The office no longer accepts this session."));
  }
}

async function readServerSentEvents(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let unfinished = "";
  let data: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const lines = (unfinished + decoder.decode(value, { stream: true })).split(/\r?\n/);
    unfinished = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      else if (line === "" && data.length > 0) {
        onData(data.join("\n"));
        data = [];
      }
    }
  }
}

async function errorOf(response: Response, fallback: string): Promise<string> {
  const detail: unknown = await response.json().catch(() => null);
  const message = typeof detail === "object" && detail !== null && "error" in detail ? detail.error : null;
  return typeof message === "string" ? message : fallback;
}

function sequenceOf(data: string): number | null {
  try {
    const event: unknown = JSON.parse(data);
    const sequence = typeof event === "object" && event !== null && "sequence" in event ? event.sequence : null;
    return typeof sequence === "number" && Number.isInteger(sequence) ? sequence : null;
  } catch {
    return null;
  }
}
