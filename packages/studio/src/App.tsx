import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Agent, Command, Order } from "./contracts";
import type { HttpGateway } from "./adapters/http-gateway";
import { pausedByDirector } from "./application/pause";
import { useConsole } from "./application/use-console";
import { useOffice } from "./application/use-office";
import {
  Connecting,
  ConnectionScreen,
  ContractMismatch,
} from "./ui/Connection";
import { paths } from "./paths";
import {
  agentAppearance,
  appearanceFrom,
  avatarPreference,
  uploadLocalPreferences,
  type Appearance,
} from "./application/appearance";
import { Icon } from "./ui/Icon";
import { Studio, StudioHero, type DockCard } from "./ui/Studio";
import {
  ActivityView,
  AgentsView,
  ContextView,
  OrdersView,
  UsageView,
} from "./ui/ProjectViews";
import { AvatarEditor, Modal, RegisterProject } from "./ui/Dialogs";
import { OrderDetail } from "./ui/OrderDetail";
import { AgentDesk } from "./ui/AgentDesk";
import { useUnreadReplies } from "./application/unread";
import { usd } from "./ui/format";
import { announceArrival } from "./ui/arrival";
import { StudioCustomizer } from "./ui/StudioCustomizer";
import {
  projectStudio,
  studioAppearanceFrom,
  studioPreference,
  type StudioAppearance,
} from "./application/studio-appearance";
import { studioSummary, defaultStudioPreferences } from "./studio/model";
import { studioAgentAppearance } from "./studio/presentation";
import { Brand } from "./design/Brand";

type Tab =
  | "studio"
  | "decisions"
  | "orders"
  | "agents"
  | "activity"
  | "context"
  | "costs";
type Dialog =
  | { kind: "agent"; id: string }
  | { kind: "order"; id: string }
  | { kind: "studio" | "register" }
  | Panel
  | null;
// The panels have an address: the fragment says which one is open, so a reload or a shared link opens it again.
type Alert = {
  key: string;
  icon: string;
  text: string;
  attention?: boolean;
  action?: { label: string; icon: string; waits?: boolean; run: () => void };
};
const panels = ["activity", "board", "context", "costs", "agents"] as const;
type Panel = { kind: (typeof panels)[number] };
const isPanel = (name: string | undefined): name is Panel["kind"] =>
  (panels as readonly string[]).includes(name ?? "");
const panelOf = (dialog: Dialog): Panel | null =>
  dialog && isPanel(dialog.kind) ? { kind: dialog.kind } : null;
const panelInAddress = (): Panel | null => {
  const named = location.hash.slice(1);
  return isPanel(named) ? { kind: named } : null;
};
type Unsaved = { appearance: Appearance; studio: StudioAppearance };
const nothingUnsaved: Unsaved = { appearance: {}, studio: {} };
const tabs: Array<{ id: Tab; name: string; icon: string }> = [
  { id: "studio", name: "The studio", icon: "office" },
  { id: "decisions", name: "Decisions", icon: "chat" },
  { id: "orders", name: "Work orders", icon: "orders" },
  { id: "agents", name: "Agents", icon: "team" },
  { id: "activity", name: "Activity", icon: "activity" },
  { id: "context", name: "Context", icon: "context" },
  { id: "costs", name: "Costs", icon: "usage" },
];
const NARROW = "(max-width: 760px)";
const projectKey = "skynot.project";
const sidebarKey = "skynot.sidebar";
const simulatedNoticeKey = "skynot.simulated-notice";
// A failure is announced where it first shows; shown again somewhere else it is the same notice, not a second alert.
type Failure = {
  id: number;
  text: string;
  repeated: boolean;
  announcedIn: Dialog | "elsewhere";
};

export function App() {
  const { office, connect, disconnect } = useOffice();
  if (office.stage === "starting")
    return <Connecting address={office.address} />;
  if (office.stage === "asking")
    return (
      <ConnectionScreen
        address={office.address}
        secret={office.secret}
        problem={office.problem}
        onConnect={connect}
      />
    );
  if (office.stage === "mismatched")
    return <ContractMismatch {...office} onLeave={disconnect} />;
  return (
    <Console
      gateway={office.gateway}
      remote={office.remote}
      onDisconnect={disconnect}
    />
  );
}

function Console({
  gateway,
  remote,
  onDisconnect,
}: {
  gateway: HttpGateway;
  remote: string | null;
  onDisconnect: () => void;
}) {
  const [projectId, setProjectId] = useState(rememberedProject);
  const { snapshot, error, stream, reload } = useConsole(gateway, projectId);
  const [dialog, setDialog] = useState<Dialog>(panelInAddress);
  const [behind, setBehind] = useState<Panel | null>(null);
  const panel = panelOf(dialog) ?? behind;
  useEffect(() => {
    const shown = panelInAddress()?.kind ?? null;
    if (shown === (panel?.kind ?? null)) return;
    if (panel) history.pushState(null, "", `#${panel.kind}`);
    else history.replaceState(null, "", location.pathname + location.search);
  }, [panel?.kind]);
  useEffect(() => {
    const follow = () => {
      setBehind(null);
      setDialog(panelInAddress());
    };
    addEventListener("popstate", follow);
    return () => removeEventListener("popstate", follow);
  }, []);
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  useEffect(() => {
    const width = matchMedia(NARROW);
    const follow = () => setNarrow(width.matches);
    width.addEventListener("change", follow);
    return () => width.removeEventListener("change", follow);
  }, []);
  const [dockChoice, setDock] = useState<DockCard | null>(null);
  const [dockCalls, setDockCalls] = useState(0);
  const callDock = (card: DockCard) => {
    setDock(card);
    setDockCalls((calls) => calls + 1);
  };
  const [dismissed, setDismissed] = useState<string[]>(() =>
    remembered(simulatedNoticeKey) === "dismissed" ? ["simulated"] : [],
  );
  const dismiss = (key: string) => {
    if (key === "simulated") remember(simulatedNoticeKey, "dismissed");
    setDismissed((keys) => [...keys, key]);
  };
  const [collapsed, setCollapsed] = useState(
    () => remembered(sidebarKey) === "collapsed",
  );
  // Under this width the sidebar lies across the top and a panel covers it with everything else.
  const sidebarCovered = panel !== null && narrow;
  const [unsaved, setUnsaved] = useState(nothingUnsaved);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const toastRef = useRef<HTMLDivElement>(null);
  const latestDialog = useRef(dialog);
  latestDialog.current = dialog;
  useEffect(() => {
    setFailure((current) =>
      current && current.announcedIn !== dialog
        ? { ...current, announcedIn: "elsewhere" }
        : current,
    );
  }, [dialog]);
  useEffect(() => toastRef.current?.showPopover(), []);
  const [, setMinute] = useState(0);
  useEffect(() => {
    const tick = setInterval(() => setMinute((value) => value + 1), 60_000);
    return () => clearInterval(tick);
  }, []);
  const project = snapshot?.project;
  const preferences = snapshot?.preferences;
  const appearance = useMemo(
    () => ({ ...appearanceFrom(preferences ?? {}), ...unsaved.appearance }),
    [preferences, unsaved],
  );
  const studioAppearance = useMemo(
    () => ({ ...studioAppearanceFrom(preferences ?? {}), ...unsaved.studio }),
    [preferences, unsaved],
  );
  useEffect(() => setUnsaved(nothingUnsaved), [snapshot?.cursor]);
  const uploaded = useRef(false);
  useEffect(() => {
    if (!preferences || uploaded.current) return;
    uploaded.current = true;
    void uploadLocalPreferences(preferences, async (command) => {
      await gateway.send(command);
    }).catch(() => undefined);
  }, [preferences]);
  const studioSettings = project
    ? projectStudio(studioAppearance, project.id)
    : defaultStudioPreferences;
  function acknowledge(text: string) {
    clearTimeout(confirmationTimer.current);
    setConfirmation(text);
    confirmationTimer.current = setTimeout(() => setConfirmation(""), 5000);
  }
  function fail(text: string) {
    setFailure((current) => ({
      id: (current?.id ?? 0) + 1,
      text,
      repeated: current !== null,
      announcedIn: latestDialog.current,
    }));
  }
  async function send(command: Command) {
    if (busy) return false;
    setBusy(true);
    try {
      await gateway.send(command);
      setFailure(null);
      return true;
    } catch (cause) {
      fail(failureOf(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }
  function toggleSidebar() {
    remember(sidebarKey, collapsed ? "expanded" : "collapsed");
    setCollapsed(!collapsed);
  }
  function chooseProject(id: string) {
    setProjectId(id);
    remember(projectKey, id);
    setBehind(null);
    setDialog(null);
  }
  async function savePreference(
    command: Command | null,
    look: Partial<Unsaved>,
    saved: string,
  ) {
    if (!command) {
      fail("The service cannot store a look under this id.");
      return;
    }
    const sender = dialog;
    setUnsaved((current) => ({
      appearance: { ...current.appearance, ...look.appearance },
      studio: { ...current.studio, ...look.studio },
    }));
    if (await send(command)) {
      if (latestDialog.current === sender) closeOver();
      acknowledge(saved);
    } else setUnsaved(nothingUnsaved);
  }
  const selectedAgent =
    dialog?.kind === "agent"
      ? project?.agents.find((a) => a.id === dialog.id)
      : null;
  const selectedOrder =
    dialog?.kind === "order"
      ? project?.orders.find((o) => o.id === dialog.id)
      : null;
  // An agent or an order opened from a panel covers it, and closing gives the panel back.
  const openOver = (next: Dialog) => {
    setBehind(panelOf(dialog) ?? behind);
    setDialog(next);
  };
  const closeOver = () => {
    setDialog(behind);
    setBehind(null);
  };
  const closePanel = () => {
    setBehind(null);
    setDialog(null);
  };
  const underDialog = Boolean(selectedAgent ?? selectedOrder);
  const openAgent = (agent: Agent) => openOver({ kind: "agent", id: agent.id });
  const openOrder = (order: Order) => openOver({ kind: "order", id: order.id });
  const active =
    project?.agents.filter((a) => a.status === "working").length ?? 0;
  const queued =
    project?.agents.filter((a) => a.status === "queued").length ?? 0;
  const pending = project?.needsYou ?? 0;
  const toSign =
    project?.orders.filter((o) => o.status === "awaiting_signature").length ??
    0;
  const blocked = project?.orders.filter((o) => o.blocked !== null).length ?? 0;
  const dock = dockChoice ?? (pending > 0 ? "decisions" : "manager");
  const unread = useUnreadReplies(
    project?.id,
    project?.chat ?? [],
    dock === "manager" && dialog === null,
  );
  const openManager = () => {
    setDialog(null);
    callDock("manager");
  };
  const failing =
    snapshot?.readiness.filter((f) => f.level === "fail").length ?? 0;
  const toReview =
    snapshot?.readiness.filter((f) => f.level === "warn").length ?? 0;
  // A notice is keyed by what it says, so dismissing one does not silence the next.
  const alerts: Alert[] = [
    ...(snapshot?.simulated
      ? [
          {
            key: "simulated",
            icon: "office",
            text: "SIMULATED ENGINES / The agents are not doing real work.",
          },
        ]
      : []),
    ...(snapshot?.paused && !pausedByDirector(snapshot.paused)
      ? [
          {
            key: `shop-paused:${snapshot.paused.reason}`,
            attention: true,
            icon: "pause",
            text: `The shop is paused: nothing new starts, what is running finishes. It paused itself because ${snapshot.paused.reason}.`,
            action: {
              label: "Resume the shop",
              icon: "play",
              waits: true,
              run: () => void send({ name: "resume-shop", payload: {} }),
            },
          },
        ]
      : []),
    ...(failing + toReview > 0
      ? [
          {
            key: `setup:${failing}:${toReview}`,
            attention: true,
            icon: "shield",
            text: `SETUP / ${failing} failing, ${toReview} to review.`,
            action: {
              label: "Review setup",
              icon: "arrow",
              run: () => setDialog({ kind: "context" }),
            },
          },
        ]
      : []),
  ];
  // A dialog covers the page or makes it inert, so a failure is shown inside the one that is open.
  const dialogShown =
    dialog?.kind === "register" ||
    Boolean(
      project &&
      dialog &&
      (dialog.kind === "agent"
        ? selectedAgent
        : dialog.kind === "order"
          ? selectedOrder
          : true),
    );
  const failureNotice = failure && (
    <FailureNotice
      key={failure.id}
      text={failure.text}
      announced={failure.announcedIn === dialog}
      glows={failure.repeated}
      onDismiss={() => setFailure(null)}
    />
  );
  const panelNotice = !underDialog && failureNotice;
  // The sidebar is a set of shortcuts: the office stays where it is and each entry opens over it.
  const panelOfEntry: Partial<Record<Tab, Panel["kind"]>> = {
    orders: "board",
    agents: "agents",
    activity: "activity",
    context: "context",
    costs: "costs",
  };
  const shown: Tab =
    (Object.keys(panelOfEntry) as Tab[]).find(
      (entry) => panelOfEntry[entry] === panel?.kind,
    ) ?? "studio";
  const show = (entry: Tab) => {
    const opens = panelOfEntry[entry];
    setBehind(null);
    setDialog(opens ? { kind: opens } : null);
    if (entry === "decisions") callDock("decisions");
  };
  // The numbers of the project at a glance: shown with the costs, in their view and in their panel.
  const stats = project && snapshot && (
    <section class="stats" aria-label="Project metrics">
      <div class="stat">
        <span class="stat-icon lavender">
          <Icon name="code" />
        </span>
        <div>
          <span class="stat-label">ACTIVE RUNS</span>
          <strong>
            {active}
            <small> / {project.agents.length} agents</small>
          </strong>
          <span class="stat-detail">
            {queued} queued ·{" "}
            {snapshot.paused
              ? "shop paused"
              : project.paused
                ? "project paused"
                : "queue open"}
          </span>
        </div>
      </div>
      <button
        class="stat stat-clickable"
        onClick={() => setDialog({ kind: "board" })}
      >
        <span class="stat-icon mint">
          <Icon name="check" />
        </span>
        <div>
          <span class="stat-label">WORK ORDERS</span>
          <strong>
            {project.orders.length}
            <small> in this project</small>
          </strong>
          <span class="stat-detail">
            {project.orders.filter((o) => o.status === "delivered").length}{" "}
            delivered · {toSign} to sign
          </span>
        </div>
      </button>
      <button class="stat stat-clickable" onClick={() => show("decisions")}>
        <span class="stat-icon blue">
          <Icon name="chat" />
        </span>
        <div>
          <span class="stat-label">WAITING FOR YOU</span>
          <strong>
            {pending}
            <small> to decide</small>
          </strong>
          <span class="stat-detail">
            {project.inbox.length}{" "}
            {project.inbox.length === 1 ? "question" : "questions"} ·{" "}
            {pending - project.inbox.length - blocked} to sign
            {blocked > 0 && ` · ${blocked} blocked`}
          </span>
        </div>
      </button>
      <button
        class="stat stat-clickable"
        onClick={() => setDialog({ kind: "costs" })}
      >
        <span class="stat-icon peach">
          <Icon name="wallet" />
        </span>
        <div>
          <span class="stat-label">COST TODAY · USD</span>
          <strong>
            {usd(snapshot.costs.today)}
            <small>
              {snapshot.costs.cap === null
                ? ""
                : ` of ${usd(snapshot.costs.cap)}`}
            </small>
          </strong>
          <span class="stat-detail">
            {usd(project.spentUsd)} on this project · UTC day
          </span>
        </div>
      </button>
    </section>
  );
  return (
    <div
      class={`app-shell skynot-shell ${collapsed ? "sidebar-collapsed" : ""}`}
    >
      <a class="skip-link" href="#studio" inert={panel !== null}>
        Skip to the studio
      </a>
      <header class="topbar">
        <a
          class="brand"
          href="#studio"
          inert={sidebarCovered || (panel !== null && collapsed)}
          onClick={(event) => {
            event.preventDefault();
            closePanel();
          }}
        >
          <Brand />
        </a>
        {project ? (
          <div class="topbar-studio" inert={panel !== null}>
            <div>
              <h1>
                The{" "}
                <button
                  class="heading-link"
                  onClick={() => setDialog({ kind: "context" })}
                  title="Open this project's context"
                >
                  {project.name}
                </button>{" "}
                studio.
              </h1>
              {project.description && <p>{project.description}</p>}
            </div>
            <span class="studio-live-label">
              {active} WORKING · {project.agents.length} AGENTS
            </span>
          </div>
        ) : (
          <div class="workspace-breadcrumb">
            <span>Workspace</span>
            <Icon name="arrow" />
            <strong>Your dev shop</strong>
          </div>
        )}
        <div class="top-actions" inert={panel !== null}>
          {project && snapshot && (
            <>
              <div
                class="studio-pause-controls"
                role="group"
                aria-label="Pause"
              >
                <button
                  class={project.paused ? "paused" : ""}
                  aria-disabled={busy}
                  onClick={() =>
                    void send({
                      name: project.paused ? "resume-project" : "pause-project",
                      payload: { project: project.id },
                    })
                  }
                  aria-label={
                    project.paused
                      ? "Resume this project"
                      : "Pause this project"
                  }
                  title="While this project is paused nothing new starts in it; what is running finishes. The other projects keep working."
                >
                  <Icon name={project.paused ? "play" : "pause"} />
                  <span>
                    <span class="pause-verb">
                      {project.paused ? "Resume this " : "Pause this "}
                    </span>
                    project
                  </span>
                </button>
                <button
                  class={snapshot.paused ? "paused" : ""}
                  aria-disabled={busy}
                  onClick={() =>
                    void send({
                      name: snapshot.paused ? "resume-shop" : "pause-shop",
                      payload: {},
                    })
                  }
                  aria-label={
                    snapshot.paused ? "Resume the shop" : "Pause the shop"
                  }
                  title="While the shop is paused nothing new starts in any project; what is running finishes."
                >
                  <Icon name={snapshot.paused ? "play" : "pause"} />
                  <span>
                    <span class="pause-verb">
                      {snapshot.paused ? "Resume the " : "Pause the "}
                    </span>
                    shop
                  </span>
                </button>
              </div>
              <button
                class="icon-button"
                onClick={() => setDialog({ kind: "studio" })}
                aria-label="Style the studio"
                title="Style the studio"
              >
                <Icon name="gear" />
              </button>
            </>
          )}
          <a
            class="icon-button design-link"
            href={paths.design}
            aria-label="Open identity and design"
            title="Identity and design"
          >
            <Icon name="star" />
          </a>
          <button
            class="icon-button"
            onClick={openManager}
            aria-label="Open the chat with the Manager"
            title="Your Manager"
          >
            <Icon name="chat" />
          </button>
        </div>
      </header>
      <aside class="sidebar" inert={sidebarCovered}>
        <div>
          <button
            class="sidebar-toggle"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          >
            <Icon name="sidebar" />
            <span>COLLAPSE</span>
          </button>
          <div class="project-nav-heading">
            <span>PROJECTS</span>
            <button
              class="icon-button"
              onClick={() => setDialog({ kind: "register" })}
              aria-label="Register a project"
              title="Register a project"
            >
              <Icon name="plus" />
            </button>
          </div>
          <div class="project-nav">
            {snapshot?.projects.map((p) => (
              <button
                class={`project-switch ${p.id === project?.id ? "selected" : ""}`}
                key={p.id}
                aria-current={p.id === project?.id ? "true" : undefined}
                title={p.paused ? `${p.repo} · paused` : p.repo}
                onClick={() => chooseProject(p.id)}
              >
                <span
                  class="project-initial"
                  style={{ color: p.accent, background: p.accent + "12" }}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>
                    {p.name}
                    {p.paused && <em class="project-paused">PAUSED</em>}
                  </strong>
                  <small>
                    {studioAppearance[p.id]
                      ? studioSummary(projectStudio(studioAppearance, p.id))
                      : p.repo}
                  </small>
                </span>
                {p.needsYou > 0 && (
                  <b
                    class="nav-counter"
                    role="img"
                    aria-label={`${p.needsYou} waiting for you`}
                  >
                    {p.needsYou}
                  </b>
                )}
              </button>
            ))}
          </div>
          <div class="nav-divider" />
          <nav class="nav-group" aria-label="Project views">
            {tabs.map((t) => (
              <button
                class={`nav-item ${shown === t.id ? "active" : ""}`}
                onClick={() => show(t.id)}
                aria-current={shown === t.id ? "page" : undefined}
                title={t.name}
                key={t.id}
              >
                <Icon name={t.icon} />
                <span>{t.name}</span>
                {t.id === "decisions" && pending > 0 && (
                  <b class="nav-counter">{pending}</b>
                )}
                {t.id === "orders" && toSign > 0 && (
                  <b class="nav-counter">{toSign}</b>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div class="sidebar-bottom">
          <a class="brand-guide-link" href={paths.github} title="GitHub kit">
            <Icon name="link" />
            <span>GitHub kit</span>
          </a>
          <a
            class="brand-guide-link"
            href={paths.design}
            title="Identity and design"
          >
            <Icon name="star" />
            <span>Identity and design</span>
          </a>
          <button
            class="manager-nav"
            title="Your Manager"
            onClick={openManager}
          >
            <Icon name="chat" />
            <span>Your Manager</span>
            {unread > 0 && <b>{unread}</b>}
          </button>
          <span class="side-footer">YOU DIRECT. AGENTS BUILD.</span>
        </div>
      </aside>
      <main id="studio" tabIndex={-1} inert={panel !== null}>
        {(snapshot || failure) && (
          <div class="shell-banners">
            {!dialogShown && failureNotice}
            {alerts
              .filter((alert) => !dismissed.includes(alert.key))
              .map((alert) => (
                <div
                  class={`shop-banner ${alert.attention ? "attention" : ""}`}
                  role="status"
                  key={alert.key}
                >
                  <span>
                    <Icon name={alert.icon} /> {alert.text}
                  </span>
                  {alert.action && (
                    <button
                      aria-disabled={alert.action.waits && busy}
                      onClick={alert.action.run}
                    >
                      {alert.action.label}
                      <Icon name={alert.action.icon} />
                    </button>
                  )}
                  <button
                    class="toast-close"
                    aria-label="Dismiss this notice"
                    onClick={() => dismiss(alert.key)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ))}
          </div>
        )}
        {error && (
          <div class="error-banner" role="alert">
            <p>{error}</p>
            <button class="secondary-button" onClick={reload}>
              Retry
            </button>
          </div>
        )}
        {!snapshot && !error && (
          <div class="loading-state">
            <span class="tiny-led" />
            Reading the shop…
          </div>
        )}
        {snapshot && project && (
          <>
            <StudioHero
              key={project.id}
              project={project}
              paused={snapshot.paused}
              appearance={appearance}
              settings={studioSettings}
              onAgent={openAgent}
              onManager={openManager}
              onOrder={openOrder}
              onTeam={() => setDialog({ kind: "agents" })}
              onOrders={() => setDialog({ kind: "board" })}
              onActivity={() => setDialog({ kind: "activity" })}
              onStats={() => setDialog({ kind: "costs" })}
              onContext={() => setDialog({ kind: "context" })}
              dock={dock}
              dockCalls={dockCalls}
              onDock={callDock}
              onDockUse={() => setDock("manager")}
              unread={unread}
              covered={dialog !== null}
              reconnecting={stream === "reconnecting"}
              send={send}
              busy={busy}
            />
            <section class="view active" key={project.id}>
              <Studio
                project={project}
                appearance={appearance}
                settings={studioSettings}
                onAgent={openAgent}
                onOrder={openOrder}
                onOrders={() => setDialog({ kind: "board" })}
              />
            </section>
            <footer class="main-footer">
              <span>STATE OUTSIDE THE LLM. HUMAN IN THE LOOP.</span>
              <span>
                {remote && (
                  <span class="office-link">
                    OFFICE <b>{remote}</b>
                    <button
                      class="text-button"
                      onClick={onDisconnect}
                      aria-label={`Disconnect from ${remote}`}
                    >
                      Disconnect
                    </button>
                  </span>
                )}
                {stream !== "connecting" && (
                  <>
                    <span
                      class={`tiny-led ${stream === "live" ? "" : "disconnected"}`}
                    />
                    <span>{stream === "live" ? "LIVE" : "RECONNECTING"}</span>
                  </>
                )}
              </span>
            </footer>
          </>
        )}
      </main>
      {dialog?.kind === "studio" && project && (
        <Modal
          notice={failureNotice}
          title="A place for this project."
          eyebrow={`${project.name.toUpperCase()} · STUDIO STYLE`}
          onClose={() => setDialog(null)}
          size="wide"
        >
          <StudioCustomizer
            project={project}
            appearance={appearance}
            settings={studioSettings}
            busy={busy}
            onSave={(value) =>
              void savePreference(
                studioPreference(project.id, value),
                { studio: { [project.id]: value } },
                "Style saved for this project.",
              )
            }
          />
        </Modal>
      )}
      {dialog?.kind === "register" && (
        <Modal
          notice={failureNotice}
          title="Bring a repository in."
          eyebrow="WORKSPACE · NEW PROJECT"
          onClose={() => setDialog(null)}
        >
          <RegisterProject
            send={send}
            busy={busy}
            onClose={() => setDialog(null)}
          />
        </Modal>
      )}
      {panel?.kind === "board" && project && (
        <Modal
          notice={panelNotice}
          title="Work orders."
          eyebrow={`${project.name.toUpperCase()} · THE BOARD`}
          onClose={closePanel}
          size="full"
          covered={underDialog}
        >
          <OrdersView project={project} onOrder={openOrder} />
        </Modal>
      )}
      {panel?.kind === "context" && project && snapshot && (
        <Modal
          notice={panelNotice}
          title="What the team knows."
          eyebrow={`${project.name.toUpperCase()} · CONTEXT`}
          onClose={closePanel}
          size="full"
          covered={underDialog}
        >
          <ContextView
            project={project}
            readiness={snapshot.readiness}
            send={send}
            busy={busy}
          />
        </Modal>
      )}
      {panel?.kind === "agents" && project && (
        <Modal
          notice={panelNotice}
          title="The right team."
          eyebrow={`${project.name.toUpperCase()} · AGENTS`}
          onClose={closePanel}
          size="full"
          covered={underDialog}
        >
          <AgentsView
            project={project}
            appearance={appearance}
            settings={studioSettings}
            onAgent={openAgent}
            send={send}
            busy={busy}
          />
        </Modal>
      )}
      {panel?.kind === "costs" && project && snapshot && (
        <Modal
          notice={panelNotice}
          title="What it takes."
          eyebrow={`${project.name.toUpperCase()} · STATS AND COSTS`}
          onClose={closePanel}
          size="full"
          covered={underDialog}
        >
          {stats}
          <UsageView project={project} costs={snapshot.costs} />
        </Modal>
      )}
      {panel?.kind === "activity" && project && (
        <Modal
          notice={panelNotice}
          title="What happened."
          eyebrow={`${project.name.toUpperCase()} · ACTIVITY`}
          onClose={closePanel}
          size="full"
          covered={underDialog}
        >
          <ActivityView
            project={project}
            appearance={appearance}
            settings={studioSettings}
            onAgent={openAgent}
            onOrder={openOrder}
          />
        </Modal>
      )}
      {selectedAgent && project && (
        <Modal
          notice={failureNotice}
          title="At their desk."
          eyebrow={`${project.name.toUpperCase()} · ${selectedAgent.role.toUpperCase()}`}
          onClose={closeOver}
          size="wide"
        >
          <AgentDesk
            key={selectedAgent.id}
            project={project}
            agent={selectedAgent}
            {...studioAgentAppearance(
              project.id,
              selectedAgent,
              appearance,
              studioSettings,
            )}
            send={send}
            busy={busy}
            onOrder={openOrder}
            onManager={openManager}
            look={
              <AvatarEditor
                agent={selectedAgent}
                avatar={
                  agentAppearance(project.id, selectedAgent, appearance).avatar
                }
                alias={
                  appearance[`${project.id}/${selectedAgent.id}`]?.alias ?? ""
                }
                settings={studioSettings}
                followStudioLook={
                  appearance[`${project.id}/${selectedAgent.id}`]
                    ?.followStudioLook ?? true
                }
                busy={busy}
                onSave={(avatar, alias, followStudioLook) => {
                  const look = {
                    avatar,
                    alias: alias.trim(),
                    followStudioLook,
                  };
                  void savePreference(
                    avatarPreference(project.id, selectedAgent.id, look),
                    {
                      appearance: {
                        [`${project.id}/${selectedAgent.id}`]: look,
                      },
                    },
                    "Avatar saved for this agent and project.",
                  );
                }}
              />
            }
          />
        </Modal>
      )}
      {selectedOrder && snapshot && project && (
        <Modal
          notice={failureNotice}
          title={selectedOrder.title}
          eyebrow={`${project.name.toUpperCase()} · ${selectedOrder.id}`}
          onClose={closeOver}
          size="wide"
        >
          <OrderDetail
            project={project}
            order={selectedOrder}
            simulated={snapshot.simulated}
            send={send}
            busy={busy}
          />
        </Modal>
      )}
      <div id="toast" ref={toastRef} popover="manual" role="status">
        {confirmation || null}
      </div>
    </div>
  );
}

function FailureNotice({
  text,
  announced,
  glows,
  onDismiss,
}: {
  text: string;
  announced: boolean;
  glows: boolean;
  onDismiss: () => void;
}) {
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (announced && glows) announceArrival(notice.current);
  }, []);
  return (
    <div
      class="failure-notice"
      role={announced ? "alert" : undefined}
      ref={notice}
    >
      <span>{text}</span>
      <button
        class="toast-close"
        aria-label="Dismiss this notice"
        onClick={onDismiss}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

function failureOf(cause: unknown): string {
  if (!(cause instanceof Error) || cause instanceof TypeError)
    return "The command was not sent.";
  const reason = /[.!?]$/.test(cause.message)
    ? cause.message
    : `${cause.message}.`;
  return `The office refused: ${reason}`;
}

function rememberedProject(): string | undefined {
  return remembered(projectKey) ?? undefined;
}

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // the choice only lasts until the page reloads
  }
}
