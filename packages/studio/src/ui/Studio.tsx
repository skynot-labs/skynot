import { useEffect, useRef, useState } from "preact/hooks";
import type { Agent, Order, Project, Send, Snapshot } from "../contracts";
import type { Appearance } from "../application/appearance";
import {
  agentBubble,
  studioAgentAppearance,
  studioScene,
} from "../studio/presentation";
import {
  defaultStudioPreferences,
  studioSummary,
  type StudioPreferences,
} from "../studio/model";
import { places, layoutChoices } from "../studio/catalog";
import { Office } from "./office-renderer";
import type { OfficeStage, StageHandlers } from "../stage/office-stage";
import {
  officeLayout,
  assignStudioSeats,
  getStudioLayout,
  type StudioZone,
} from "./office-layout";
import { DecisionInbox } from "./DecisionInbox";
import { announceArrival } from "./arrival";
import { ManagerChat } from "./Dialogs";
import { Icon } from "./Icon";
import { OrderChip } from "./OrderDetail";
import { AvatarCanvas } from "./AvatarCanvas";
import { ago, agentStatus } from "./format";

export type DockCard = "decisions" | "manager";

const stillKey = "skynot.office-still";
const LESS_MOTION = "(prefers-reduced-motion: reduce)";

function rememberedStill(): boolean {
  try {
    return localStorage.getItem(stillKey) === "yes";
  } catch {
    return false;
  }
}

export function StudioHero({
  project,
  paused,
  appearance,
  settings = defaultStudioPreferences,
  onAgent,
  onManager,
  onOrder,
  onTeam,
  onOrders,
  onActivity,
  onStats,
  onClock,
  onContext,
  dock,
  dockCalls,
  onDock,
  onDockUse,
  unread,
  send,
  busy,
  covered = false,
  reconnecting,
}: {
  project: Project;
  paused: Snapshot["paused"];
  appearance: Appearance;
  settings?: StudioPreferences;
  onAgent: (agent: Agent) => void;
  onManager: () => void;
  onOrder: (order: Order) => void;
  onTeam: () => void;
  onOrders: () => void;
  onActivity: () => void;
  onStats: () => void;
  onClock: () => void;
  onContext: () => void;
  dock: DockCard;
  // Counts every time a card is asked for, so one that is already open still answers.
  dockCalls: number;
  onDock: (card: DockCard) => void;
  onDockUse: () => void;
  unread: number;
  send: Send;
  busy: boolean;
  covered?: boolean;
  reconnecting: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const office = useRef<Office | null>(null);
  const inbox = useRef<HTMLDivElement>(null);
  const layout = getStudioLayout(settings.layout);
  const pending = project.needsYou;
  const toggle = (card: DockCard) =>
    onDock(dock !== card ? card : card === "manager" ? "decisions" : "manager");
  useEffect(() => {
    if (dockCalls > 0)
      announceArrival(
        inbox.current?.querySelector(".director-inbox:not(.collapsed)"),
      );
  }, [dockCalls]);
  const stageHost = useRef<HTMLDivElement>(null);
  const stage = useRef<OfficeStage | null>(null);
  const stageHandlers = useRef<StageHandlers | null>(null);
  const [live, setLive] = useState(false);
  const [still, setStill] = useState(rememberedStill);
  const latestStill = useRef(still);
  latestStill.current = still;
  const [lessMotion, setLessMotion] = useState(
    () => matchMedia(LESS_MOTION).matches,
  );
  useEffect(() => {
    const preference = matchMedia(LESS_MOTION);
    const follow = () => setLessMotion(preference.matches);
    preference.addEventListener("change", follow);
    return () => preference.removeEventListener("change", follow);
  }, []);
  function holdStill(next: boolean) {
    setStill(next);
    try {
      localStorage.setItem(stillKey, next ? "yes" : "no");
    } catch {
      // the choice only lasts until the page reloads
    }
  }
  const scene = studioScene(
    project,
    appearance,
    settings,
    paused !== null,
    unread,
  );
  const latestCovered = useRef(covered);
  latestCovered.current = covered;
  const latestScene = useRef(scene);
  latestScene.current = scene;
  // The still frame is what shows until the stage is up, and what stays if the browser cannot run it.
  useEffect(() => {
    if (!canvas.current) return;
    const renderer = new Office(canvas.current);
    office.current = renderer;
    renderer.draw(latestScene.current, 0, canvas.current.clientWidth / officeLayout.width);
    stage.current?.show(latestScene.current);
  }, [project, appearance, settings, paused, unread]);
  useEffect(() => stage.current?.rest(covered), [covered]);
  useEffect(() => stage.current?.hold(still), [still]);
  useEffect(() => {
    let gone = false;
    void import("../stage/office-stage")
      .then(({ OfficeStage }) =>
        OfficeStage.mount(stageHost.current!, () => stageHandlers.current!),
      )
      .then((mounted) => {
        if (gone) return mounted.destroy();
        stage.current = mounted;
        mounted.hold(latestStill.current);
        mounted.rest(latestCovered.current);
        mounted.show(latestScene.current);
        setLive(true);
      })
      .catch((error: unknown) =>
        console.warn(
          "The live office could not start; the still frame stays.",
          error,
        ),
      );
    return () => {
      gone = true;
      stage.current?.destroy();
      stage.current = null;
    };
  }, []);
  const officeLabel = `${project.name} studio: ${studioSummary(settings)}, ${layoutChoices[settings.layout].name}. Management, design, development and the decision desk. Use the zone and team buttons to interact.`;
  function hit(event: MouseEvent) {
    const rect = canvas.current!.getBoundingClientRect();
    const ratio = rect.width / officeLayout.width;
    return office.current?.hit(
      (event.clientX - rect.left) / ratio,
      (event.clientY - rect.top) / ratio,
    );
  }
  // Without a tab the desk opens on whatever is waiting.
  function openDesk(tab?: "questions" | "signatures") {
    onDock("decisions");
    inbox.current?.scrollIntoView({
      behavior: lessMotion ? "instant" : "smooth",
      block: "nearest",
    });
    if (!tab) return;
    const entry = inbox.current?.querySelector<HTMLButtonElement>(
      `#director-${project.id}-${tab}`,
    );
    entry?.click();
    entry?.focus();
  }
  function openZone(zone: StudioZone) {
    if (zone === "manager") onManager();
    else if (zone === "decisions") openDesk();
    else onTeam();
  }
  function openAgent(agent: Agent) {
    if (agent.kind === "manager") onManager();
    else onAgent(agent);
  }
  const agentOf = (id: string) =>
    project.agents.find((member) => member.id === id);
  stageHandlers.current = {
    onAgent: (id) => {
      const agent = agentOf(id);
      if (agent) openAgent(agent);
    },
    onBubble: (id) => {
      const agent = agentOf(id);
      if (agent) openBubble(agent);
    },
    onDecisions: () => openDesk(),
    onBoard: onOrders,
    onManager,
    onStats,
    onClock,
  };
  function openBubble(agent: Agent) {
    const target = agentBubble(project, agent, unread)?.open;
    const order =
      target?.kind === "order" &&
      project.orders.find((candidate) => candidate.id === target.id);
    if (order) onOrder(order);
    else if (target?.kind === "desk") openDesk(target.tab);
    else openAgent(agent);
  }
  return (
    <section class="studio-hero panel" aria-label={`${project.name} studio`}>
      <div class="studio-hero-stage">
        <div class={`studio-canvas-room ${live ? "live" : ""}`}>
          <canvas
            ref={canvas}
            id="officeCanvas"
            width={officeLayout.width}
            height={officeLayout.height}
            aria-label={live ? undefined : officeLabel}
            onMouseMove={(event) => {
              const target = hit(event);
              if (office.current) office.current.hover = target?.id ?? null;
              event.currentTarget.style.cursor = target ? "pointer" : "default";
            }}
            onMouseLeave={() => {
              if (office.current) office.current.hover = null;
            }}
            onClick={(event) => {
              const target = hit(event);
              if (target?.id === "board") return onOrders();
              if (target?.kind === "zone")
                return openZone(target.id as StudioZone);
              const agent = project.agents.find(
                (member) => member.id === target?.id.replace("bubble:", ""),
              );
              if (agent && target?.kind === "bubble") openBubble(agent);
              else if (agent) openAgent(agent);
            }}
          />
          <div
            class="office-stage"
            ref={stageHost}
            role="img"
            aria-label={live ? officeLabel : undefined}
            aria-hidden={live ? undefined : true}
          />
          <div class="studio-shortcuts">
            <button
              onClick={onActivity}
              aria-label="Open the activity log"
              title="Activity log"
            >
              <Icon name="activity" />
            </button>
            <button
              onClick={onTeam}
              aria-label="Open the team"
              title="The team"
            >
              <Icon name="team" />
            </button>
            {project.schedule && (
              <button
                onClick={onClock}
                aria-label="Open the scheduled tasks"
                title="Scheduled tasks"
              >
                <Icon name="clock" />
              </button>
            )}
            {live && (
              <button
                onClick={() => holdStill(!still)}
                aria-pressed={still || lessMotion}
                disabled={lessMotion}
                aria-label="Hold the office still"
                title={
                  lessMotion
                    ? "Your system asks for less motion, which holds the office still"
                    : still
                      ? "Wake the office"
                      : "Hold the office still"
                }
              >
                <Icon name={still || lessMotion ? "play" : "pause"} />
              </button>
            )}
          </div>
        </div>
        <div class="studio-inbox-dock" ref={inbox}>
          <DecisionInbox
            key={project.id}
            project={project}
            send={send}
            busy={busy}
            onManager={onManager}
            onOrder={onOrder}
            onTeam={onTeam}
            collapsed={dock !== "decisions"}
            onToggle={() => toggle("decisions")}
          />
          <ManagerDock
            project={project}
            send={send}
            busy={busy}
            open={dock === "manager"}
            unread={unread}
            onToggle={() => toggle("manager")}
            onUse={onDockUse}
            onOrder={onOrder}
          />
        </div>
        {(paused || project.paused || reconnecting) && (
          <div class="studio-pause-labels" role="status">
            {reconnecting && (
              <div class="studio-pause-label">
                <Icon name="link" />
                Reconnecting…
              </div>
            )}
            {project.paused && (
              <div class="studio-pause-label">
                <Icon name="pause" />
                This project is paused · {project.paused.reason}
              </div>
            )}
            {paused && (
              <div class="studio-pause-label">
                <Icon name="pause" />
                The shop is paused: nothing new starts, what is running finishes
                · {paused.reason}
              </div>
            )}
          </div>
        )}
      </div>
      <nav class="studio-zone-nav" aria-label="Studio zones">
        {layout.zones.map((zone) => (
          <button
            key={zone.id}
            onClick={() => openZone(zone.id)}
            style={{ "--zone-color": zone.color }}
          >
            <Icon name={zone.icon} />
            <span>
              <strong>{zone.name}</strong>
              <small>{zone.description}</small>
            </span>
            {zone.id === "decisions" && pending > 0 && <b>{pending}</b>}
            <Icon name="arrow" />
          </button>
        ))}
      </nav>
      <footer class="studio-hero-footer">
        <span>
          <Icon name="code" />
          {project.repo}
        </span>
        <span class="studio-theme-summary">
          <Icon name={places[settings.place].icon} />
          {studioSummary(settings)} · {layoutChoices[settings.layout].name}
        </span>
        <button onClick={onContext}>
          Context
          <Icon name="arrow" />
        </button>
      </footer>
    </section>
  );
}

function ManagerDock({
  project,
  send,
  busy,
  open,
  unread,
  onToggle,
  onUse,
  onOrder,
}: {
  project: Project;
  send: Send;
  busy: boolean;
  open: boolean;
  unread: number;
  onToggle: () => void;
  // The director is writing here: the card must not close under them when something lands on the desk.
  onUse: () => void;
  onOrder: (order: Order) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const manager = project.agents.find((agent) => agent.kind === "manager");
  const busyManager =
    manager?.status === "working" || manager?.status === "queued";
  useEffect(() => {
    if (open && !wasOpen.current) {
      const messages = body.current?.querySelector(".chat-messages");
      if (messages) messages.scrollTop = messages.scrollHeight;
      body.current?.querySelector("textarea")?.focus();
    }
    wasOpen.current = open;
  }, [open]);
  return (
    <section
      class={`director-inbox manager-dock ${open ? "" : "collapsed"}`}
      aria-label="Your Manager"
    >
      <button class="inbox-heading" onClick={onToggle} aria-expanded={open}>
        <span class="director-icon">
          <Icon name="chat" />
        </span>
        <div>
          <span class="eyebrow">ONE MANAGER. ALL THE CONTEXT.</span>
          <h2>Your Manager</h2>
        </div>
        {busyManager && <span class="tiny-led" title="Working on a turn" />}
        {unread > 0 && (
          <span
            class="inbox-counter waiting"
            title={unread === 1 ? "1 unread reply" : `${unread} unread replies`}
          >
            {unread}
          </span>
        )}
        <Icon name="chevron" />
      </button>
      <div class="manager-dock-body" ref={body} onFocusCapture={onUse}>
        <ManagerChat
          project={project}
          send={send}
          busy={busy}
          onOrder={onOrder}
        />
      </div>
    </section>
  );
}

export function Studio({
  project,
  appearance,
  settings = defaultStudioPreferences,
  onAgent,
  onOrder,
  onOrders,
}: {
  project: Project;
  appearance: Appearance;
  settings?: StudioPreferences;
  onAgent: (agent: Agent) => void;
  onOrder: (order: Order) => void;
  onOrders: () => void;
}) {
  const outside =
    project.agents.length -
    assignStudioSeats(project.agents, getStudioLayout(settings.layout)).filter(
      (seat) => seat.agent,
    ).length;
  return (
    <>
      <section class="panel studio-team-strip" aria-label="Project team">
        <div class="panel-heading">
          <span class="panel-title">The team in the studio</span>
          {outside > 0 && (
            <span class="pill">{outside} MORE ON THE TEAM</span>
          )}
        </div>
        <div class="studio-team-members">
          {project.agents.map((agent) => {
            const visual = studioAgentAppearance(
              project.id,
              agent,
              appearance,
              settings,
            );
            return (
              <button
                class="studio-team-member"
                key={agent.id}
                onClick={() => onAgent(agent)}
              >
                <AvatarCanvas avatar={visual.avatar} name={visual.name} />
                <div>
                  <strong>{visual.name}</strong>
                  <small>{agent.orderId ?? agent.role}</small>
                  <span class={`status-chip ${agent.status}`}>
                    {agentStatus[agent.status]}
                    {agent.queuePosition !== null &&
                      ` · number ${agent.queuePosition}`}
                  </span>
                </div>
                <Icon name="edit" />
              </button>
            );
          })}
        </div>
      </section>
      <div class="bottom-layout">
        <section class="panel work-preview">
          <div class="panel-heading">
            <span class="panel-title">Work in motion</span>
            <button class="text-button" onClick={onOrders}>
              All work orders
              <Icon name="arrow" />
            </button>
          </div>
          {project.orders
            .filter(
              (order) => !["delivered", "discarded"].includes(order.status),
            )
            .slice(0, 3)
            .map((order) => (
              <button
                class="work-preview-row"
                onClick={() => onOrder(order)}
                key={order.id}
              >
                <span class={`order-marker ${order.status}`} />
                <span class="mono muted">{order.id}</span>
                <span>{order.title}</span>
                <OrderChip order={order} />
                <Icon name="arrow" />
              </button>
            ))}
          {!project.orders.some(
            (order) => !["delivered", "discarded"].includes(order.status),
          ) && (
            <div class="empty-state">
              The next idea starts with a conversation.
            </div>
          )}
        </section>
        <section class="panel activity-panel">
          <div class="panel-heading">
            <span class="panel-title">In the studio</span>
          </div>
          {project.activity.length === 0 && (
            <div class="empty-state">
              What the team does will land here as it happens.
            </div>
          )}
          {project.activity.slice(0, 3).map((activity) => (
            <div class="activity-item" key={activity.sequence}>
              <span class="log-icon">
                <Icon
                  name={
                    activity.kind === "run"
                      ? "code"
                      : activity.kind === "advice"
                        ? "team"
                        : "orders"
                  }
                />
              </span>
              <div>
                {activity.text}
                <small>
                  {ago(activity.at)}
                  {activity.orderId ? " · " + activity.orderId : ""}
                </small>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
