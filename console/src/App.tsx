import { useCallback, useEffect, useState } from "preact/hooks";
import { command, fetchState, watch, type ShopState } from "./api";
import { Chat } from "./Chat";
import { Floor } from "./Floor";
import { Orders } from "./Orders";

export function App() {
  const [state, setState] = useState<ShopState | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchState().then(setState).catch(() => setConnected(false));
  }, []);

  useEffect(() => watch(refresh, setConnected), [refresh]);

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
        <span class="repo">{state.repo}</span>
        {state.simulated && <span class="badge">simulated engines</span>}
        <span class={`link ${connected ? "up" : "down"}`}>{connected ? "live" : "reconnecting"}</span>
        <button type="button" class="pause" onClick={() => void send(state.paused ? "/api/commands/resume-shop" : "/api/commands/pause-shop", {})}>
          {state.paused ? "Resume" : "Pause"}
        </button>
      </header>

      {state.paused && (
        <div class="notice paused" role="status">
          Paused: nothing new starts, and what is running will finish. {state.paused.reason}.
        </div>
      )}

      {notice && (
        <div class="notice" role="alert">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>dismiss</button>
        </div>
      )}

      <main class="board">
        <Chat state={state} send={send} />
        <Orders state={state} send={send} />
        <Floor state={state} send={send} />
      </main>
    </div>
  );
}
