import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import type { MinutesBucket, Order, Project, Send } from "../contracts";
import { Icon } from "./Icon";
import { RichLine } from "./RichText";
import { orderStatus, usd } from "./format";
import { orderActions, unblocking } from "./order-actions";
import "./views.css";

type OrderAction =
  | "sign-order"
  | "discard-order"
  | "start-now"
  | "stop-order"
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

const EARLIER_FINDING = {
  fixed: "Fixed.",
  not_fixed: "Not fixed.",
} as const;

const ANSWERED_BY = {
  manager: "Answered by the Manager",
  director_via_manager: "Passed on by the Manager",
} as const;

export function OrderChip({ order }: { order: Order }) {
  const tone = order.blocked ? "blocked" : order.working ? "working" : order.status;
  return (
    <span class={`status-chip ${tone}`}>
      {order.blocked
        ? "Blocked"
        : `${orderStatus[order.status]}${order.working ? " · working" : ""}`}
    </span>
  );
}

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
  const top = useRef<HTMLDivElement>(null);
  // Signing, discarding or answering takes the pressed button away: focus goes to the row that says what the order became.
  const leaves = (name: OrderAction) =>
    name === "sign-order" || name === "discard-order";
  const action = (
    name: OrderAction,
    label: string,
    style: "primary" | "secondary" | "danger" = "secondary",
  ) => (
    <button
      type="button"
      class={`${style}-button ${name === "discard-order" ? "order-discard" : ""}`}
      aria-disabled={busy}
      onClick={() =>
        void send({ name, payload: { orderId } }).then((ok) => {
          if (ok && leaves(name)) top.current?.focus();
        })
      }
    >
      {label}
    </button>
  );
  const unblock = unblocking(order);
  const can = orderActions(order, simulated || project.local);
  const lastAnswered = order.answered.at(-1);
  const answeredThroughManager = lastAnswered?.answeredBy
    ? { ...lastAnswered, answeredBy: lastAnswered.answeredBy }
    : undefined;

  return (
    <>
      <div class="order-detail-top" ref={top} tabIndex={-1}>
        <OrderChip order={order} />
        {order.ticket !== null && (
          <span class="mono">From ticket #{order.ticket}</span>
        )}
      </div>
      <p class="order-objective">
        <RichLine text={order.summary} />
      </p>

      <WorkerQuestion
        order={order}
        send={send}
        busy={busy}
        onSent={() => top.current?.focus()}
      />
      {answeredThroughManager && (
        <p class="form-note">
          {ANSWERED_BY[answeredThroughManager.answeredBy]}:{" "}
          {answeredThroughManager.question} → {answeredThroughManager.answer}
        </p>
      )}
      {order.blocked && (
        <div class="order-notice blocked">
          Blocked: {order.blocked}
          {unblock && (
            <div class="order-inline-actions">
              <button
                type="button"
                class="primary-button"
                aria-disabled={busy}
                onClick={() => void send(unblock.command)}
              >
                {unblock.label}
              </button>
              {order.protectedPaths.length > 0 && order.status === "in_review" && (
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
              disabled={!can.reassign}
              aria-disabled={busy}
              title={order.working ? "Stop the work to change the worker." : undefined}
              onChange={(event) => {
                const select = event.currentTarget;
                void send({
                  name: "reassign-order",
                  payload: { orderId, worker: select.value },
                }).then((ok) => {
                  if (!ok) select.value = order.worker ?? "developer";
                });
              }}
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
                aria-disabled={busy}
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
        <h4>THE BRIEF · WHAT THE TEAM BUILDS FROM</h4>
        <p>
          <RichLine text={order.objective} />
        </p>
        {order.context && (
          <p class="muted">
            <RichLine text={order.context} />
          </p>
        )}
      </section>
      {order.approach.length > 0 && (
        <section class="order-section">
          <h4>APPROACH</h4>
          <ol>
            {order.approach.map((step) => (
              <li key={step}>
                <RichLine text={step} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {order.likelyFiles.length > 0 && (
        <section class="order-section">
          <h4>LIKELY FILES</h4>
          <p class="mono order-files">{order.likelyFiles.join(" · ")}</p>
        </section>
      )}
      {order.dependencies && order.dependencies.length > 0 && (
        <section class="order-section">
          <h4>DEPENDENCIES IT INSTALLS</h4>
          <p class="mono order-files">{order.dependencies.map((dependency) => (dependency.dev ? `${dependency.name} (dev)` : dependency.name)).join(" · ")}</p>
        </section>
      )}
      <section class="order-section">
        <h4>ACCEPTANCE CRITERIA</h4>
        <ul>
          {order.criteria.map((criterion) => (
            <li key={criterion.statement}>
              <RichLine text={criterion.statement} />
              <small>
                {criterion.verification.kind}:{" "}
                <RichLine text={criterion.verification.detail} />
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
              <li key={item}>
                <RichLine text={item} />
              </li>
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
          {can.discard && action("discard-order", "Discard", "danger")}
          {can.sign && action("sign-order", "Sign", "primary")}
          {can.stop && action("stop-order", "Stop", "danger")}
          {can.merge && action("merge-pull-request", simulated ? "Merge (simulated)" : "Merge")}
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
      {review?.diffOnly && (
        <p class="order-notice">
          Judged from the diff alone: the reviewer could not read the
          repository or run the tests where the shop runs, so this does not
          count as reviewed. Setup, in Context, says how to fix it.
        </p>
      )}
      {review?.verdict === "approved" && (
        <p>
          Approved by the reviewer. <RichLine text={review.summary} />
        </p>
      )}
      {review?.verdict === "changes_requested" && (
        <div class="order-notice blocked">
          <strong>Reviewer asks for changes.</strong>{" "}
          <RichLine text={review.summary} />
          {review.earlier && review.earlier.length > 0 && (
            <ul class="earlier-findings">
              {review.earlier.map(({ finding, status, proof }) => (
                <li key={finding} class={status && `finding-${status}`}>
                  {status && <strong>{EARLIER_FINDING[status]}</strong>}{" "}
                  <RichLine text={finding} />
                  <small>{proof}</small>
                </li>
              ))}
            </ul>
          )}
          {review.findings.length > 0 && (
            <ol>
              {review.findings.map((finding) => (
                <li key={finding}>
                  <RichLine text={finding} />
                </li>
              ))}
            </ol>
          )}
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

// The one place a worker's question is answered from, wherever it is shown.
export function WorkerQuestion({
  order,
  send,
  busy,
  onSent,
}: {
  order: Order;
  send: Send;
  busy: boolean;
  onSent: () => void;
}) {
  if (!order.question) return null;
  return (
    <div class="order-notice">
      The worker is waiting for your answer: {order.question}
      <TextForm
        label="Answer"
        placeholder="Your answer for the worker"
        busy={busy}
        submit={(answer) =>
          send({
            name: "answer-question",
            payload: { orderId: order.id, answer },
          })
        }
        onSent={onSent}
      />
    </div>
  );
}

function TextForm({
  label,
  placeholder,
  busy,
  submit,
  onSent,
}: {
  label: string;
  placeholder: string;
  busy: boolean;
  submit: (text: string) => Promise<boolean>;
  onSent?: () => void;
}) {
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  return (
    <form
      class="order-text-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim() || !(await submit(text.trim()))) return;
        // Emptying the field disables the button that was pressed, so focus leaves it first: for the field, unless the form is about to go.
        (onSent ?? (() => field.current?.focus()))();
        setText("");
      }}
    >
      <input
        ref={field}
        type="text"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onInput={(event) => setText(event.currentTarget.value)}
      />
      <button
        type="submit"
        class="secondary-button"
        disabled={!text.trim()}
        aria-disabled={busy}
      >
        {label}
      </button>
    </form>
  );
}
