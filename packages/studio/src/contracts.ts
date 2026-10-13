import type { Activity, Answered, BriefingChange, Command, Decision, Finding, InboxItem, Message, Order, PauseState, Report, Run, ScheduledTask, Soul, State, TeamChange, TokenUsage } from "@skynot/contract";
import type { Avatar } from "./avatars/model";

export type {
  Activity,
  Answered,
  BriefingChange,
  Command,
  Decision,
  Finding,
  InboxItem,
  Message,
  MinutesBucket,
  Order,
  PauseState,
  Report,
  Run,
  ScheduledTask,
  Soul,
  State as ShopState,
  TeamChange,
  TokenUsage,
} from "@skynot/contract";
export type { Avatar } from "./avatars/model";

export type AgentStatus = "working" | "queued" | "idle" | "waiting-director" | "error";
export type Agent = {
  id: string;
  name: string;
  role: string;
  kind: "manager" | "worker" | "advisor";
  engine: string;
  model: string | null;
  status: AgentStatus;
  orderId: string | null;
  runId: string | null;
  queuePosition: number | null;
  runs: number;
  spentUsd: number | null;
  usage: TokenUsage | null;
  soul: Soul | null;
  instructions: string | null;
  avatar: Avatar;
};

export type ProjectSummary = State["projects"][number] & { name: string; accent: string };

export type Project = {
  id: string;
  name: string;
  description: string | null;
  repo: string;
  accent: string;
  paused: PauseState | null;
  reviewing: boolean;
  workers: string[];
  agents: Agent[];
  orders: Order[];
  inbox: InboxItem[];
  chat: readonly Message[];
  decisions: Decision[];
  teamChanges: TeamChange[];
  briefingChanges: BriefingChange[];
  briefing: State["briefing"];
  hireable: State["hireable"];
  activity: readonly Activity[];
  // Null when the office was built before it had a schedule.
  schedule: ScheduledTask[] | null;
  reports: Report[];
  runs: Run[];
  answered: Answered[];
  spentUsd: number;
  tokens: TokenUsage | null;
  needsYou: number;
};

export type Snapshot = {
  project: Project;
  projects: ProjectSummary[];
  paused: State["paused"];
  readiness: readonly Finding[];
  costs: { today: number; total: number; cap: number | null; days: Array<{ day: string; usd: number }> };
  preferences: Record<string, unknown>;
  cursor: number;
  simulated: boolean;
};

export type Send = (command: Command) => Promise<boolean>;
