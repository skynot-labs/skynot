import { useCallback, useEffect, useState } from "preact/hooks";
import { command, fetchState, watch, type ShopState } from "./api";
import { Chat } from "./Chat";
import { Floor } from "./Floor";
import { Inbox } from "./Inbox";
import { Orders } from "./Orders";

export function App() {
  const [state, setState] = useState<ShopState | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [project, setProject] = useState<string | undefined>(remembered());

  const refresh = useCallback(() => {
    fetchState(project).then(setState).catch(() => setConnected(false));
  }, [project]);

  useEffect(() => watch(refresh, setConnected), [refresh]);

  const choose = (id: string) => {
    setProject(id);
    remember(id);
  };

  const send = useCallback(async (path: string, body: object) => {
    const problem = await command(path, body);
    setNotice(problem);
    return problem === null;
  }, []);

  if (!state) return <p class="booting">{connected ? "Reading the shop…" : "Waiting for the shop to answer…"}</p>;

  return (
    <div class="shell">
      <header class="masthead">
        <h1>skynot</h1>
        {state.projects.length > 1 ? (
          <nav class="projects" aria-label="Projects">
            {state.projects.map((entry) => (
              <button type="button" key={entry.id} class={entry.id === state.project.id ? "current" : ""} onClick={() => choose(entry.id)} title={entry.repo}>
                {entry.id}
                {entry.needsYou > 0 && <span class="needs" title="waiting for you">{entry.needsYou}</span>}
              </button>
            ))}
          </nav>
        ) : (
          <span class="repo">{state.repo}</span>
        )}
        {state.simulated && <span class="badge">simulated engines</span>}
        <span class={`link ${connected ? "up" : "down"}`}>{connected ? "live" : "reconnecting"}</span>
        <span class="cost">
          ${state.costs.today.toFixed(2)} today{state.costs.cap !== null ? ` of $${state.costs.cap.toFixed(2)}` : ""}
          {state.projects.length > 1 && `, $${state.costs.project.toFixed(2)} on ${state.project.id}`}
        </span>
        <button type="button" class="pause" onClick={() => void send(state.paused ? "/api/commands/resume-shop" : "/api/commands/pause-shop", {})}>
          {state.paused ? "Resume" : "Pause"}
        </button>
      </header>

      {state.paused && (
        <div class="notice paused" role="status">
          Paused: nothing new starts, and what is running will finish. {state.paused.reason}.
        </div>
      )}

      {state.readiness.some((finding) => finding.level !== "ok") && (
        <details class="notice readiness" open={state.readiness.some((finding) => finding.level === "fail")}>
          <summary>
            Setup: {state.readiness.filter((finding) => finding.level === "fail").length} failing, {state.readiness.filter((finding) => finding.level === "warn").length} to review
          </summary>
          <ul>
            {state.readiness
              .filter((finding) => finding.level !== "ok")
              .map((finding) => (
                <li key={finding.check}>
                  <strong>{finding.level === "fail" ? "Failing" : "Review"}: {finding.check}.</strong> {finding.detail}
                  {finding.fix && <div>To fix: {finding.fix}</div>}
                </li>
              ))}
          </ul>
          <button type="button" onClick={() => void send("/api/commands/recheck", {})}>check again</button>
        </details>
      )}

      {notice && (
        <div class="notice" role="alert">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>dismiss</button>
        </div>
      )}

      <Inbox state={state} send={send} />

      <main class="board">
        <Chat state={state} send={send} />
        <Orders state={state} send={send} />
        <Floor state={state} send={send} />
      </main>
    </div>
  );
}

const KEY = "skynot.project";

function remembered(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // the choice only lasts until the page reloads
  }
}
