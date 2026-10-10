import type { ShopState } from "./api";

type Send = (path: string, body: object) => Promise<boolean>;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function Floor({ state, send }: { state: ShopState; send: Send }) {
  const { working, waiting } = state.presence;
  const idle = working.length === 0 && waiting.length === 0;

  return (
    <aside class="panel floor" aria-label="Shop floor and logbook">
      <h2>Shop floor</h2>
      {idle && <p class="empty">Everyone is idle.</p>}
      <ul class="presence">
        {working.map((entry) => (
          <li key={entry.runId}>
            <span class="role">{entry.role}</span> working{entry.orderId ? ` on ${entry.orderId}` : ""} <span class="engine">({entry.engine})</span>{" "}
            <button type="button" class="stop" onClick={() => send("/api/commands/stop-run", { runId: entry.runId })}>Stop</button>
          </li>
        ))}
        {waiting.map((entry) => (
          <li key={entry.runId} class="waiting">
            <span class="role">{entry.role}</span> waiting, number {entry.position} in line{" "}
            <button type="button" class="stop" onClick={() => send("/api/commands/stop-run", { runId: entry.runId })}>Stop</button>
          </li>
        ))}
      </ul>

      <h2>Team</h2>
      <ul class="presence">
        {state.team.map((member) => (
          <li key={member.role}>
            <span class="role">{member.name ?? member.role}</span> {member.name && <span class="engine">[{member.role}] </span>}<span class="engine">({member.engine}, {member.model ?? "default model"})</span>
          </li>
        ))}
      </ul>

      {state.teamChanges.map((change) => (
        <div class="change" key={change.id}>
          <p>
            Proposed: <strong>{change.action}</strong> {change.role}. <span class="reason">{change.reason}</span>
            {change.focus && <span class="reason"> New focus: {change.focus}</span>}
          </p>
          <div class="actions">
            <button type="button" class="sign" onClick={() => send("/api/commands/sign-team-change", { changeId: change.id })}>Sign</button>
            <button type="button" onClick={() => send("/api/commands/discard-team-change", { changeId: change.id })}>Discard</button>
          </div>
        </div>
      ))}
      {state.briefingChanges.map((change) => (
        <div class="change" key={change.id}>
          <p>
            Proposed: <strong>new briefing</strong>. <span class="reason">{change.reason}</span>
          </p>
          <pre class="briefing">{change.text}</pre>
          <div class="actions">
            <button type="button" class="sign" onClick={() => send("/api/commands/sign-briefing-change", { changeId: change.id })}>Sign</button>
            <button type="button" onClick={() => send("/api/commands/discard-briefing-change", { changeId: change.id })}>Discard</button>
          </div>
        </div>
      ))}
      {state.hireable.length > 0 && (
        <p class="hireable">
          Could be hired: {state.hireable.map((role) => role.name).join(", ")}
        </p>
      )}

      <h2>Logbook</h2>
      {state.activity.length === 0 && <p class="empty">Nothing has happened yet.</p>}
      <ol class="logbook">
        {state.activity.map((entry) => (
          <li key={entry.sequence} class={entry.kind}>
            <time>{clock(entry.at)}</time>
            <span class="what">
              {entry.orderId && <strong>{entry.orderId} </strong>}
              {entry.url ? <a href={entry.url} target="_blank" rel="noreferrer">{entry.text}</a> : entry.text}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
