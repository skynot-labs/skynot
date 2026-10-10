import { useEffect, useRef } from "preact/hooks";
import type { Agent, Order, Project, Send, Snapshot } from "../contracts";
import type { Appearance } from "../application/appearance";
import {
  studioAgentAppearance,
  studioScene,
  waitingOnDirector,
} from "../studio/presentation";
import {
  defaultStudioPreferences,
  studioSummary,
  type StudioPreferences,
} from "../studio/model";
import { places, layoutChoices } from "../studio/catalog";
import { Office } from "./office-renderer";
import {
  officeLayout,
  assignStudioSeats,
  getStudioLayout,
  type StudioZone,
} from "./office-layout";
import { DecisionInbox } from "./DecisionInbox";
import { Icon } from "./Icon";
import { AvatarCanvas } from "./AvatarCanvas";
import { agentStatus, clock } from "./format";

const firstLine = (text: string | null) =>
  text
    ?.split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);

export function StudioHero({
  project,
  paused,
  appearance,
  settings = defaultStudioPreferences,
  onAgent,
  onManager,
  onOrder,
  onTeam,
  onContext,
  onPause,
  onCustomize,
  send,
  busy,
}: {
  project: Project;
  paused: Snapshot["paused"];
  appearance: Appearance;
  settings?: StudioPreferences;
  onAgent: (agent: Agent) => void;
  onManager: () => void;
  onOrder: (order: Order) => void;
  onTeam: () => void;
  onContext: () => void;
  onPause: () => void;
  onCustomize: () => void;
  send: Send;
  busy: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const office = useRef<Office | null>(null);
  const inbox = useRef<HTMLDivElement>(null);
  const layout = getStudioLayout(settings.layout);
  const active = project.agents.filter(
    (agent) => agent.status === "working",
  ).length;
  const pending = waitingOnDirector(project);
  useEffect(() => {
    if (!canvas.current) return;
    const renderer = new Office(canvas.current);
    office.current = renderer;
    const scene = studioScene(project, appearance, settings, paused !== null);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.draw(scene, 0);
    const timer = reduced
      ? undefined
      : setInterval(() => {
          if (!document.hidden) renderer.draw(scene, performance.now());
        }, 300);
    return () => clearInterval(timer);
  }, [project, appearance, settings, paused]);
  function hit(event: MouseEvent) {
    const rect = canvas.current!.getBoundingClientRect();
    const ratio = rect.width / officeLayout.width;
    return office.current?.hit(
      (event.clientX - rect.left) / ratio,
      (event.clientY - rect.top) / ratio,
    );
  }
  function openZone(zone: StudioZone) {
    if (zone === "manager") onManager();
    else if (zone === "decisions") {
      inbox.current?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
      const questions =
        inbox.current?.querySelector<HTMLButtonElement>('[role="tab"]');
      questions?.click();
      questions?.focus();
    } else onTeam();
  }
  return (
    <section
      class="studio-hero panel"
      aria-label={`${project.name} studio`}
    >
      <header class="studio-hero-heading">
        <div>
          <h1>
            The <span>{project.name}</span> studio.
          </h1>
          <p>
            {firstLine(project.briefing) ??
              "Your company of agents, working toward one vision."}
          </p>
        </div>
        <div class="studio-hero-actions">
          <span class="studio-live-label">
            {active} WORKING · {project.agents.length} AGENTS
          </span>
          <button class="secondary-button" onClick={onCustomize}>
            <Icon name="edit" />
            Style the studio
          </button>
          <button class="secondary-button" onClick={onManager}>
            <Icon name="chat" />
            Talk to your Manager
          </button>
          <button
            class="icon-button"
            disabled={busy}
            onClick={onPause}
            aria-label={paused ? "Resume the shop" : "Pause the shop"}
            title="While paused nothing new starts; what is running finishes."
          >
            <Icon name={paused ? "play" : "pause"} />
          </button>
        </div>
      </header>
      <div class="studio-hero-stage">
        <div class="studio-canvas-room">
          <canvas
            ref={canvas}
            id="officeCanvas"
            width={officeLayout.width}
            height={officeLayout.height}
            aria-label={`${project.name} studio: ${studioSummary(settings)}, ${layoutChoices[settings.layout].name}. Management, design, development and the decision desk. Use the zone and team buttons to interact.`}
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
              if (target?.kind === "zone") openZone(target.id as StudioZone);
              else {
                const agent = project.agents.find(
                  (member) => member.id === target?.id,
                );
                if (agent?.kind === "manager") onManager();
                else if (agent) onAgent(agent);
              }
            }}
          />
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
          />
        </div>
        {paused && (
          <div class="studio-pause-label" role="status">
            <Icon name="pause" />
            Paused: nothing new starts, what is running finishes ·{" "}
            {paused.reason}
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

export function Studio({
  project,
  appearance,
  settings = defaultStudioPreferences,
  onAgent,
  onOrders,
}: {
  project: Project;
  appearance: Appearance;
  settings?: StudioPreferences;
  onAgent: (agent: Agent) => void;
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
          <span class="pill">
            {outside > 0
              ? `${outside} MORE ON THE TEAM`
              : "PRESENCE"}
          </span>
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
                      ` · #${agent.queuePosition}`}
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
                onClick={onOrders}
                key={order.id}
              >
                <span class={`order-marker ${order.status}`} />
                <span class="mono muted">{order.id}</span>
                <span>{order.title}</span>
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
            <span class="activity-dot" />
          </div>
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
                  {clock(activity.at)}
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
