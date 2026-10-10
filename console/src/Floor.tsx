import type { ShopState } from "./api";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function Floor({ state }: { state: ShopState }) {
  const { working, waiting } = state.presence;
  const idle = working.length === 0 && waiting.length === 0;

  return (
    <aside class="panel floor" aria-label="Shop floor and logbook">
      <h2>Shop floor</h2>
      {idle && <p class="empty">Everyone is idle.</p>}
      <ul class="presence">
        {working.map((entry) => (
          <li key={entry.runId}>
            <span class="role">{entry.role}</span> working{entry.orderId ? ` on ${entry.orderId}` : ""} <span class="engine">({entry.engine})</span>
          </li>
        ))}
        {waiting.map((entry) => (
          <li key={entry.runId} class="waiting">
            <span class="role">{entry.role}</span> waiting, number {entry.position} in line
          </li>
        ))}
      </ul>

      <h2>Team</h2>
      <ul class="presence">
        {state.team.map((member) => (
          <li key={member.role}>
            <span class="role">{member.role}</span> <span class="engine">({member.engine}, {member.model ?? "default model"})</span>
          </li>
        ))}
      </ul>

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
