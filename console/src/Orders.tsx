import type { MinutesBucket, OrderView, ShopState } from "./api";

type Send = (path: string, body: object) => Promise<boolean>;

const STAGES: Array<{ title: string; statuses: OrderView["status"][] }> = [
  { title: "Needs your signature", statuses: ["awaiting_signature"] },
  { title: "On the bench", statuses: ["signed", "on_bench"] },
  { title: "In review", statuses: ["in_review"] },
  { title: "Delivered", statuses: ["delivered"] },
  { title: "Discarded", statuses: ["discarded"] },
];

const MINUTES: Array<{ bucket: MinutesBucket; label: string }> = [
  { bucket: "lt5", label: "under 5" },
  { bucket: "5-15", label: "5 to 15" },
  { bucket: "15-30", label: "15 to 30" },
  { bucket: "gt30", label: "over 30" },
];

export function Orders({ state, send }: { state: ShopState; send: Send }) {
  const stages = STAGES.map((stage) => ({ ...stage, orders: state.orders.filter((order) => stage.statuses.includes(order.status)) }));
  const nothing = state.orders.length === 0;

  return (
    <section class="panel orders" aria-label="Work orders">
      <h2>Work orders</h2>
      {nothing && <p class="empty">No work orders yet. They appear here when the Manager files one.</p>}
      {stages
        .filter((stage) => stage.orders.length > 0)
        .map((stage) => (
          <div class="stage" key={stage.title}>
            <h3>{stage.title} <span class="count">{stage.orders.length}</span></h3>
            {stage.orders.map((order) => (
              <OrderCard key={order.id} order={order} simulated={state.simulated} send={send} />
            ))}
          </div>
        ))}
    </section>
  );
}

function OrderCard({ order, simulated, send }: { order: OrderView; simulated: boolean; send: Send }) {
  const act = (name: string, extra: object = {}) => send(`/api/commands/${name}`, { orderId: order.id, ...extra });

  return (
    <article class={`order ${order.status}`}>
      <pre class="card">{order.card}</pre>

      {order.blocked && <p class="blocked">Blocked: {order.blocked}</p>}

      <div class="links">
        {order.issueUrl && <a href={order.issueUrl} target="_blank" rel="noreferrer">issue</a>}
        {order.pullRequestUrl && <a href={order.pullRequestUrl} target="_blank" rel="noreferrer">pull request</a>}
      </div>

      {order.status === "awaiting_signature" && (
        <div class="actions">
          <button type="button" class="sign" onClick={() => act("sign-order")}>Sign</button>
          <button type="button" onClick={() => act("discard-order")}>Discard</button>
        </div>
      )}

      {order.status === "signed" && (
        <div class="actions">
          <button type="button" onClick={() => act("discard-order")}>Discard</button>
        </div>
      )}

      {order.status === "in_review" && simulated && (
        <div class="actions">
          <button type="button" onClick={() => send("/api/dev/merge-pull-request", { orderId: order.id })}>Merge (simulated)</button>
        </div>
      )}

      {order.status === "delivered" && order.minutes === null && (
        <div class="minutes">
          <p>How many minutes did it cost you?</p>
          <div class="choices">
            {MINUTES.map(({ bucket, label }) => (
              <button type="button" key={bucket} onClick={() => act("record-minutes", { bucket })}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {order.minutes && <p class="spent">Cost you {MINUTES.find((entry) => entry.bucket === order.minutes)?.label} minutes.</p>}

      <details>
        <summary>Details</summary>
        <p>{order.objective}</p>
        <ul>
          {order.criteria.map((criterion) => (
            <li key={criterion.statement}>
              {criterion.statement}
              <span class="verify"> — {criterion.verification.kind}: {criterion.verification.detail}</span>
            </li>
          ))}
        </ul>
        {order.outOfScope.length > 0 && <p class="scope">Out of scope: {order.outOfScope.join("; ")}</p>}
        <p class="risk">Risk: {order.risk}</p>
      </details>
    </article>
  );
}
