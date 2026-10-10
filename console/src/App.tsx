import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Agent, Command, Order } from "./contracts";
import { HttpGateway } from "./adapters/http-gateway";
import { useConsole } from "./application/use-console";
import {
  agentAppearance,
  appearanceFrom,
  avatarPreference,
  uploadLocalPreferences,
  type Appearance,
} from "./application/appearance";
import { Icon } from "./ui/Icon";
import { Studio, StudioHero } from "./ui/Studio";
import { DecisionInbox } from "./ui/DecisionInbox";
import {
  ActivityView,
  AgentsView,
  ContextView,
  OrdersView,
  UsageView,
} from "./ui/ProjectViews";
import {
  AvatarEditor,
  ManagerChat,
  Modal,
  RegisterProject,
} from "./ui/Dialogs";
import { OrderDetail } from "./ui/OrderDetail";
import { usd } from "./ui/format";
import { StudioCustomizer } from "./ui/StudioCustomizer";
import {
  projectStudio,
  studioAppearanceFrom,
  studioPreference,
  type StudioAppearance,
} from "./application/studio-appearance";
import { studioSummary, defaultStudioPreferences } from "./studio/model";
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
  | { kind: "manager" | "studio" | "register" }
  | null;
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
const headings: Record<Exclude<Tab, "studio">, [string, string, string]> = {
  decisions: [
    "Your judgment",
    "unblocks the team.",
    "Questions, conflicts and approvals for this project.",
  ],
  orders: [
    "From a good idea",
    "to delivered software.",
    "Every order has a scope, an owner and a decision behind it.",
  ],
  agents: [
    "The right team.",
    "For this project.",
    "Different roles and tools. One intent.",
  ],
  activity: [
    "Every step counts.",
    "Every event stays.",
    "The history of the work, outside the LLM's memory.",
  ],
  context: [
    "Before the code,",
    "the intent.",
    "Briefing, repository and limits. The context that gives the work meaning.",
  ],
  costs: [
    "Building has a cost.",
    "Keep it visible.",
    "Spend by project and order, as the CLIs report it.",
  ],
};
const projectKey = "skynot.project";
const gateway = new HttpGateway();

export function App() {
  const [projectId, setProjectId] = useState(rememberedProject);
  const { snapshot, error, connected, reload } = useConsole(gateway, projectId);
  const [tab, setTab] = useState<Tab>("studio");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [unsaved, setUnsaved] = useState(nothingUnsaved);
  const [busy, setBusy] = useState(false);
  const [notification, setNotification] = useState("");
  const [noticeId, setNoticeId] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
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
  function notify(text: string) {
    if (noticeId) clearTimeout(noticeId);
    setNotification(text);
    setNoticeId(setTimeout(() => setNotification(""), 5000));
  }
  async function send(command: Command) {
    if (busy) return false;
    setBusy(true);
    try {
      await gateway.send(command);
      return true;
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : "The command was not sent.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function chooseProject(id: string) {
    setProjectId(id);
    rememberProject(id);
    setDialog(null);
    setTab("studio");
  }
  async function savePreference(
    command: Command | null,
    look: Partial<Unsaved>,
    saved: string,
  ) {
    if (!command) {
      notify("The service cannot store a look under this id.");
      return;
    }
    setUnsaved((current) => ({
      appearance: { ...current.appearance, ...look.appearance },
      studio: { ...current.studio, ...look.studio },
    }));
    setDialog(null);
    if (await send(command)) notify(saved);
    else setUnsaved(nothingUnsaved);
  }
  const selectedAgent =
    dialog?.kind === "agent"
      ? project?.agents.find((a) => a.id === dialog.id)
      : null;
  const selectedOrder =
    dialog?.kind === "order"
      ? project?.orders.find((o) => o.id === dialog.id)
      : null;
  const openAgent = (agent: Agent) =>
    setDialog({ kind: "agent", id: agent.id });
  const openOrder = (order: Order) =>
    setDialog({ kind: "order", id: order.id });
  const active =
    project?.agents.filter((a) => a.status === "working").length ?? 0;
  const queued =
    project?.agents.filter((a) => a.status === "queued").length ?? 0;
  const toSign =
    project?.orders.filter((o) => o.status === "awaiting_signature").length ??
    0;
  const pending = project
    ? project.inbox.length +
      toSign +
      project.teamChanges.length +
      project.briefingChanges.length
    : 0;
  const failing =
    snapshot?.readiness.filter((f) => f.level === "fail").length ?? 0;
  const toReview =
    snapshot?.readiness.filter((f) => f.level === "warn").length ?? 0;
  return (
    <div class="app-shell skynot-shell">
      <header class="topbar">
        <a
          class="brand"
          href="#studio"
          onClick={(event) => {
            event.preventDefault();
            setTab("studio");
          }}
        >
          <Brand />
        </a>
        <div class="workspace-breadcrumb">
          <span>Workspace</span>
          <Icon name="arrow" />
          <strong>{project?.name ?? "Your dev shop"}</strong>
        </div>
        <div class="top-actions">
          <a
            class="icon-button design-link"
            href="/design"
            aria-label="Open identity and design"
            title="Identity and design"
          >
            <Icon name="star" />
          </a>
          <button
            class="icon-button"
            onClick={() => setDialog({ kind: "manager" })}
            aria-label="Open the chat with the Manager"
            title="Your Manager"
          >
            <Icon name="chat" />
          </button>
        </div>
      </header>
      <aside class="sidebar">
        <div>
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
                    {p.needsYou > 0
                      ? `${p.needsYou} WAITING FOR YOU`
                      : studioAppearance[p.id]
                        ? studioSummary(projectStudio(studioAppearance, p.id))
                        : p.repo}
                  </small>
                </span>
                {p.needsYou > 0 ? (
                  <b class="nav-counter">{p.needsYou}</b>
                ) : (
                  <span class="project-dot" style={{ background: p.accent }} />
                )}
              </button>
            ))}
          </div>
          <div class="nav-divider" />
          <nav class="nav-group" aria-label="Project views">
            {tabs.map((t) => (
              <button
                class={`nav-item ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
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
          <a class="brand-guide-link" href="/github/">
            <Icon name="link" />
            <span>GitHub kit</span>
          </a>
          <a class="brand-guide-link" href="/design">
            <Icon name="star" />
            <span>Identity and design</span>
          </a>
          <button
            class="manager-nav"
            onClick={() => setDialog({ kind: "manager" })}
          >
            <Icon name="chat" />
            <span>Your Manager</span>
            {pending > 0 && <b>{pending}</b>}
          </button>
          <span class="side-footer">YOU DIRECT. AGENTS BUILD.</span>
        </div>
      </aside>
      <main>
        {snapshot && (
          <div class="shell-banners">
            {snapshot.simulated && (
              <div class="shop-banner">
                <span>
                  <Icon name="office" /> SIMULATED ENGINES
                  <span class="banner-separator">/</span> The agents are not
                  doing real work.
                </span>
              </div>
            )}
            {snapshot.paused && (
              <div class="shop-banner attention" role="status">
                <span>
                  <Icon name="pause" /> The shop is paused: nothing new
                  starts, and what is running will finish.{" "}
                  {snapshot.paused.reason}.
                </span>
                <button
                  disabled={busy}
                  onClick={() => void send({ name: "resume-shop", payload: {} })}
                >
                  Resume the shop
                  <Icon name="play" />
                </button>
              </div>
            )}
            {project?.paused && (
              <div class="shop-banner attention" role="status">
                <span>
                  <Icon name="pause" /> This project is paused: nothing new
                  starts in {project.name}. {project.paused.reason}.
                </span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void send({
                      name: "resume-project",
                      payload: { project: project.id },
                    })
                  }
                >
                  Resume this project
                  <Icon name="play" />
                </button>
              </div>
            )}
            {failing + toReview > 0 && (
              <div class="shop-banner attention">
                <span>
                  <Icon name="shield" /> SETUP
                  <span class="banner-separator">/</span> {failing} failing,{" "}
                  {toReview} to review.
                </span>
                <button onClick={() => setTab("context")}>
                  Review setup
                  <Icon name="arrow" />
                </button>
              </div>
            )}
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
            {tab === "studio" ? (
              <StudioHero
                key={project.id}
                project={project}
                paused={snapshot.paused}
                appearance={appearance}
                settings={studioSettings}
                onAgent={openAgent}
                onManager={() => setDialog({ kind: "manager" })}
                onOrder={openOrder}
                onTeam={() => setTab("agents")}
                onContext={() => setTab("context")}
                onCustomize={() => setDialog({ kind: "studio" })}
                send={send}
                busy={busy}
              />
            ) : (
              <section class="page-heading">
                <div>
                  <div class="eyebrow">
                    <span class="tiny-led" /> {project.name.toUpperCase()}
                    <span class="heading-phase">{project.repo}</span>
                  </div>
                  {project.description && (
                    <p class="heading-description">{project.description}</p>
                  )}
                  <h1>
                    {headings[tab][0]}
                    <br />
                    <span>{headings[tab][1]}</span>
                  </h1>
                  <p>{headings[tab][2]}</p>
                </div>
                <div class="heading-actions">
                  {pending > 0 && (
                    <button
                      class="decisions-button"
                      onClick={() => setTab("decisions")}
                    >
                      <span class="decision-dot" />
                      {pending} to decide
                    </button>
                  )}
                  <button
                    class="primary-button"
                    onClick={() => setDialog({ kind: "manager" })}
                  >
                    <Icon name="chat" />
                    Talk to the Manager
                  </button>
                </div>
              </section>
            )}
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
                onClick={() => setTab("orders")}
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
                    {
                      project.orders.filter((o) => o.status === "delivered")
                        .length
                    }{" "}
                    delivered · {toSign} to sign
                  </span>
                </div>
              </button>
              <button
                class="stat stat-clickable"
                onClick={() => setTab("decisions")}
              >
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
                    {project.inbox.length} questions ·{" "}
                    {pending - project.inbox.length} to sign
                  </span>
                </div>
              </button>
              <button
                class="stat stat-clickable"
                onClick={() => setTab("costs")}
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
            <section class="view active" key={project.id + "/" + tab}>
              {tab === "studio" && (
                <Studio
                  project={project}
                  appearance={appearance}
                  settings={studioSettings}
                  onAgent={openAgent}
                  onOrders={() => setTab("orders")}
                />
              )}{" "}
              {tab === "decisions" && (
                <div class="decision-page">
                  <DecisionInbox
                    project={project}
                    send={send}
                    busy={busy}
                    onManager={() => setDialog({ kind: "manager" })}
                    onOrder={openOrder}
                    onTeam={() => setTab("agents")}
                  />
                </div>
              )}
              {tab === "orders" && (
                <OrdersView project={project} onOrder={openOrder} />
              )}{" "}
              {tab === "agents" && (
                <AgentsView
                  project={project}
                  appearance={appearance}
                  settings={studioSettings}
                  onAgent={openAgent}
                  send={send}
                  busy={busy}
                />
              )}{" "}
              {tab === "activity" && <ActivityView project={project} />}{" "}
              {tab === "context" && (
                <ContextView
                  project={project}
                  readiness={snapshot.readiness}
                  send={send}
                  busy={busy}
                />
              )}{" "}
              {tab === "costs" && (
                <UsageView project={project} costs={snapshot.costs} />
              )}
            </section>
            <footer class="main-footer">
              <span>STATE OUTSIDE THE LLM. HUMAN IN THE LOOP.</span>
              <span>
                <span class={`tiny-led ${connected ? "" : "disconnected"}`} />
                {connected ? "LIVE" : "RECONNECTING"}
              </span>
            </footer>
          </>
        )}
        {dialog?.kind === "manager" && project && (
          <Modal
            title="Let's talk about the next idea."
            eyebrow={`MANAGER · ${project.name.toUpperCase()}`}
            onClose={() => setDialog(null)}
            wide
          >
            <ManagerChat project={project} send={send} busy={busy} />
          </Modal>
        )}
        {dialog?.kind === "studio" && project && (
          <Modal
            title="A place for this project."
            eyebrow={`${project.name.toUpperCase()} · STUDIO STYLE`}
            onClose={() => setDialog(null)}
            wide
          >
            <StudioCustomizer
              project={project}
              appearance={appearance}
              settings={studioSettings}
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
        {selectedAgent && project && (
          <Modal
            title="Their role. Their personality."
            eyebrow={`${project.name.toUpperCase()} · ${selectedAgent.role.toUpperCase()}`}
            onClose={() => setDialog(null)}
            wide
          >
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
                const look = { avatar, alias: alias.trim(), followStudioLook };
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
          </Modal>
        )}
        {selectedOrder && snapshot && project && (
          <Modal
            title="An order with intent."
            eyebrow={`${project.name.toUpperCase()} · ${selectedOrder.id}`}
            onClose={() => setDialog(null)}
            wide
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
      </main>
      {notification && (
        <div id="toast" role="status" aria-live="polite">
          {notification}
        </div>
      )}
    </div>
  );
}

function rememberedProject(): string | undefined {
  try {
    return localStorage.getItem(projectKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberProject(id: string): void {
  try {
    localStorage.setItem(projectKey, id);
  } catch {
    // the choice only lasts until the page reloads
  }
}
