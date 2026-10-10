import type { readState } from "../../src/app/http/state";
import type { Avatar } from "./avatars/model";

export type { Avatar } from "./avatars/model";

export type ShopState = ReturnType<typeof readState> & { simulated: boolean };

export type Order = ShopState["orders"][number];
export type Message = ShopState["chat"][number];
export type Decision = ShopState["decisions"][number];
export type InboxItem = ShopState["inbox"][number];
export type TeamChange = ShopState["teamChanges"][number];
export type BriefingChange = ShopState["briefingChanges"][number];
export type Activity = ShopState["activity"][number];
export type Finding = ShopState["readiness"][number];
export type MinutesBucket = NonNullable<Order["minutes"]>;

export type AgentStatus = "working" | "queued" | "idle" | "waiting-director";
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
  avatar: Avatar;
};

export type ProjectSummary = ShopState["projects"][number] & { name: string; accent: string };

export type Project = {
  id: string;
  name: string;
  repo: string;
  accent: string;
  reviewing: boolean;
  workers: string[];
  agents: Agent[];
  orders: Order[];
  inbox: InboxItem[];
  chat: readonly Message[];
  decisions: Decision[];
  teamChanges: TeamChange[];
  briefingChanges: BriefingChange[];
  briefing: ShopState["briefing"];
  hireable: ShopState["hireable"];
  activity: readonly Activity[];
  spentUsd: number;
};

export type Snapshot = {
  project: Project;
  projects: ProjectSummary[];
  paused: ShopState["paused"];
  readiness: readonly Finding[];
  costs: { today: number; total: number; cap: number | null };
  cursor: number;
  simulated: boolean;
};

type OrderCommand = "sign-order" | "retry-order" | "apply-review" | "start-now" | "review-order" | "stop-order" | "approve-protected-paths" | "discard-order";

export type Command =
  | { name: "send-message"; payload: { text: string; project: string } }
  | { name: "answer-decision"; payload: { decisionId: string; answer: string } }
  | { name: "answer-question"; payload: { orderId: string; answer: string } }
  | { name: OrderCommand; payload: { orderId: string } }
  | { name: "reassign-order"; payload: { orderId: string; worker: string } }
  | { name: "follow-up"; payload: { orderId: string; text: string } }
  | { name: "record-minutes"; payload: { orderId: string; bucket: MinutesBucket } }
  | { name: "stop-run"; payload: { runId: string } }
  | { name: "sign-team-change" | "discard-team-change" | "sign-briefing-change" | "discard-briefing-change"; payload: { changeId: string } }
  | { name: "pause-shop" | "resume-shop" | "recheck"; payload: Record<string, never> }
  | { name: "merge-pull-request"; payload: { orderId: string } };

export type Send = (command: Command) => Promise<boolean>;
