import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { MinutesBucket, Order, Project, Send } from "../contracts";
import { Icon } from "./Icon";
import { orderStatus, usd } from "./format";
import { orderActions } from "./order-actions";
import "./views.css";

type OrderAction =
  | "sign-order"
  | "discard-order"
  | "start-now"
  | "stop-order"
  | "approve-protected-paths"
  | "retry-order"
  | "apply-review"
  | "review-order"
  | "merge-pull-request";

const MINUTES: Array<{ bucket: MinutesBucket; label: string }> = [
  { bucket: "lt5", label: "under 5" },
  { bucket: "5-15", label: "5 to 15" },
  { bucket: "15-30", label: "15 to 30" },
  { bucket: "gt30", label: "over 30" },
];

const CHECKS_LABEL = {
  none: "no checks",
  pending: "checks running",
  passing: "checks passing",
  failing: "checks failing",
} as const;

export function OrderDetail({
  project,
  order,
  simulated,
  send,
  busy,
}: {
  project: Project;
  order: Order;
  simulated: boolean;
  send: Send;
  busy: boolean;
}) {
  const orderId = order.id;
  const action = (
    name: OrderAction,
    label: string,
    style: "primary" | "secondary" | "danger" = "secondary",
  ) => (
    <button
      type="button"
      class={`${style}-button`}
      disabled={busy}
      onClick={() => void send({ name, payload: { orderId } })}
    >
      {label}
    </button>
  );
  const blockedOnPaths = order.blocked !== null && order.protectedPaths.length > 0;
  const retryable =
    order.blocked !== null &&
    order.protectedPaths.length === 0 &&
    (order.status === "signed" || order.status === "on_bench");
  const can = orderActions(order, simulated);

  return (
    <>
      <div class="order-detail-top">
        <span class="mono">{order.id}</span>
        <span class={`status-chip ${order.blocked ? "blocked" : order.status}`}>
          {order.blocked ? "Blocked" : orderStatus[order.status]}
        </span>
        {order.ticket !== null && (
          <span class="mono">From ticket #{order.ticket}</span>
        )}
      </div>
      <h3 class="order-detail-title">{order.title}</h3>
      <p class="order-objective">{order.objective}</p>

      {order.question && (
        <div class="order-notice">
          The worker is waiting for your answer: {order.question}
          <TextForm
            label="Answer"
            placeholder="Your answer for the worker"
            busy={busy}
            submit={(answer) =>
              send({ name: "answer-question", payload: { orderId, answer } })
            }
          />
        </div>
      )}
      {order.blocked && (
        <div class="order-notice blocked">
          Blocked: {order.blocked}
          {(blockedOnPaths || retryable) && (
            <div class="order-inline-actions">
              {blockedOnPaths &&
                action(
                  "approve-protected-paths",
                  `Approve ${order.protectedPaths.join(", ")}`,
                  "primary",
                )}
              {retryable && action("retry-order", "Retry", "primary")}
              {blockedOnPaths && order.status === "in_review" && (
                <span>After approving, send the follow-up again.</span>
              )}
            </div>
          )}
        </div>
      )}
      {order.status === "signed" &&
        order.waitingOn.length > 0 &&
        !order.blocked && (
          <div class="dependency-detail">
            <span>WAITING FOR THESE ORDERS TO BE MERGED</span>
            <div>
              {order.waitingOn.map((id) => (
                <span class="dependency-node" key={id}>
                  <Icon name="link" />
                  {id}
                </span>
              ))}
            </div>
            <div class="order-inline-actions">
              {action("start-now", "Start now")}
            </div>
          </div>
        )}

      <div class="quote-box">
        <span>
          Worker<strong>{order.worker ?? "developer"}</strong>
        </span>
        <span>
          Risk<strong>{order.risk}</strong>
        </span>
        <span>
          Spent<strong>{usd(order.spentUsd)}</strong>
        </span>
      </div>

      {(order.issueUrl || order.pullRequestUrl) && (
        <div class="order-links">
          {order.issueUrl && (
            <a class="pr-link" href={order.issueUrl} target="_blank" rel="noreferrer">
              Issue
              <Icon name="arrow" />
            </a>
          )}
          {order.pullRequestUrl && (
            <a class="pr-link" href={order.pullRequestUrl} target="_blank" rel="noreferrer">
              Pull request
              <Icon name="arrow" />
            </a>
          )}
        </div>
      )}

      {order.status === "in_review" &&
        (project.reviewing ||
          order.ready ||
          (order.checks !== null && order.checks !== "none")) && (
          <Verdict order={order} reviewing={project.reviewing} action={action} />
        )}

      {order.status === "in_review" && (
        <section class="order-section">
          <h4>FOLLOW UP</h4>
          <TextForm
            label="Follow up"
            placeholder="Follow-up for the worker, e.g. resolve the conflicts with main"
            busy={busy}
            submit={(text) =>
              send({ name: "follow-up", payload: { orderId, text } })
            }
          />
        </section>
      )}

      {project.workers.length > 1 &&
        ["signed", "on_bench", "in_review"].includes(order.status) && (
          <>
            <label class="form-label" for="orderWorker">
              WORKER
            </label>
            <select
              id="orderWorker"
              value={order.worker ?? "developer"}
              disabled={busy || !can.reassign}
              title={order.working ? "Stop the work to change the worker." : undefined}
              onChange={(event) =>
                void send({
                  name: "reassign-order",
                  payload: { orderId, worker: event.currentTarget.value },
                })
              }
            >
              {project.workers.map((worker) => (
                <option key={worker} value={worker}>
                  {worker}
                </option>
              ))}
            </select>
          </>
        )}

      {order.status === "delivered" && order.minutes === null && (
        <section class="order-section">
          <h4>HOW MANY MINUTES DID IT COST YOU?</h4>
          <div class="order-inline-actions">
            {MINUTES.map(({ bucket, label }) => (
              <button
                type="button"
                class="secondary-button"
                key={bucket}
                disabled={busy}
                onClick={() =>
                  void send({
                    name: "record-minutes",
                    payload: { orderId, bucket },
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}
      {order.minutes && (
        <p class="form-note">
          Cost you{" "}
          {MINUTES.find((entry) => entry.bucket === order.minutes)?.label}{" "}
          minutes.
        </p>
      )}

      <section class="order-section">
        <h4>ACCEPTANCE CRITERIA</h4>
        <ul>
          {order.criteria.map((criterion) => (
            <li key={criterion.statement}>
              {criterion.statement}
              <small>
                {criterion.verification.kind}: {criterion.verification.detail}
              </small>
            </li>
          ))}
        </ul>
      </section>
      {order.outOfScope.length > 0 && (
        <section class="order-section">
          <h4>OUT OF SCOPE</h4>
          <ul>
            {order.outOfScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      <details class="order-raw">
        <summary>The card as filed</summary>
        <pre>{order.card}</pre>
      </details>

      {(can.discard || can.stop || can.merge) && (
        <div class="modal-actions">
          {can.discard && action("discard-order", "Discard")}
          {can.sign && action("sign-order", "Sign work order", "primary")}
          {can.stop && action("stop-order", "Stop", "danger")}
          {can.merge && action("merge-pull-request", "Merge (simulated)")}
        </div>
      )}
    </>
  );
}

function Verdict({
  order,
  reviewing,
  action,
}: {
  order: Order;
  reviewing: boolean;
  action: (
    name: OrderAction,
    label: string,
    style?: "primary" | "secondary" | "danger",
  ) => JSX.Element;
}) {
  const { review, checks } = order;
  return (
    <section class="order-section">
      <h4>REVIEW</h4>
      {order.ready && (
        <p class="ready-note">
          <Icon name="shield" />
          Ready to merge
        </p>
      )}
      {reviewing && !review && <p>Not reviewed yet</p>}
      {review?.verdict === "approved" && (
        <p>Approved by the reviewer. {review.summary}</p>
      )}
      {review?.verdict === "changes_requested" && (
        <div class="order-notice blocked">
          Reviewer asks for changes: {review.summary}
          <ul>
            {review.findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        </div>
      )}
      {checks && checks !== "none" && (
        <p class={`checks-${checks}`}>{CHECKS_LABEL[checks]}</p>
      )}
      {(review?.verdict === "changes_requested" || reviewing) && (
        <div class="order-inline-actions">
          {review?.verdict === "changes_requested" &&
            action("apply-review", "Send these to the worker", "primary")}
          {reviewing &&
            action("review-order", review ? "Review again" : "Review")}
        </div>
      )}
    </section>
  );
}

function TextForm({
  label,
  placeholder,
  busy,
  submit,
}: {
  label: string;
  placeholder: string;
  busy: boolean;
  submit: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  return (
    <form
      class="order-text-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (text.trim() && (await submit(text.trim()))) setText("");
      }}
    >
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <button
        type="submit"
        class="secondary-button"
        disabled={busy || !text.trim()}
      >
        {label}
      </button>
    </form>
  );
}
