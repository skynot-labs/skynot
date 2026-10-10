# Phase 3 · Control, flow and an independent reviewer

**Status:** decisions taken; slices 3.1 and 3.2 built; 3.3 and 3.4 not started. See [vision](../vision.md) and
[phase 2](phase-2.md) for what exists.

## Why

The first real runs showed what a shop needs beyond "an agent writes a pull request": two orders
conflicted with each other (#16 and #17), a restart left an order with nobody working on it, a worker
could not be stopped, and the cost of a turn was only visible by reading the log. The vision adds one
principle that nothing enforces yet: *the one who writes code never approves it*.

## What a shop needs, and the evidence that it does

Each line says whether we have seen the need. Lines without evidence are listed so they are decided
on purpose, not forgotten.

| Need | Action | Seen? |
|---|---|---|
| **Control** | Stop a run or an order that is going wrong | Yes: a worker was orphaned by a restart and nothing could stop it |
| | Pause and resume the shop (no new runs start; running ones finish) | Planned in phase 1, never built |
| | Cost per order and per day, visible, with a cap that pauses the shop | Partly: a cap per run exists; totals are only in the log |
| | Reassign an order to another worker | No: needs more than one worker first |
| | Reorder or prioritise the queue | No: the queue is never deeper than `max_parallel` |
| **Flow** | Orders declare what they depend on; dependents wait for the merge | Yes: #16 and #17 |
| | Orders that touch the same files are chained, not run in parallel | Yes: same case |
| | A pull request that goes out of date is brought up to date | Yes: the follow-up did it by hand |
| **Quality** | An independent reviewer reads every diff before the director does | Principle in the vision; no incident yet |
| | CI status shown on the order's card, "ready" only when green | Partly: the director looked at GitHub by hand |
| | Rate limit of a subscription detected and waited out | No: never seen in 11 orders, the error text is unknown |
| **Robustness** | Work in flight survives a restart | Fixed for orders (they become blocked); queued runs are not recovered |

## Slices

Each is delivered and tried with the real CLIs before the next is planned in detail. The order is open
(decision 1).

**3.1 · Control.** `AbortSignal` goes through `EngineRequest` to `exec`, which kills the process group.
The scheduler can cancel a queued or a running run. Commands: `stop-order` (cancel its run, leave it
blocked and retryable), `pause-shop` and `resume-shop` (the queue holds, running work finishes). Cost per
order and per day in the console, and a daily cap in `policy.yaml` that pauses the shop when reached.

**3.2 · Flow.** The Manager may declare `dependsOn` on an order; the order waits until those are
delivered. Orders whose `likelyFiles` overlap are chained the same way. When a pull request conflicts after
another merge, the service runs a follow-up to bring it up to date (decision 4). The merge itself stays
the director's.

**3.3 · Workers and reassignment.** `team.yaml` may declare several workers (name, engine, model).
An order has an assignee, chosen by the Manager or by the director; `reassign-order` changes it and the
next run uses the new worker. Parallel workers already exist: `max_parallel` is the limit.

**3.4 · Independent reviewer.** After a pull request opens, a read-only reviewer reads the diff and
answers approve or changes requested with reasons, as an event and a comment on the pull request. The
reviewer runs on a different engine or model than the author's. If changes are requested, the service runs
a follow-up with the findings, at most N rounds; then it stops and tells the director. CI status joins
the card here.

## Not in phase 3

Priorities and reordering, per-project rosters (phase 4), curated memory and retrospectives (phase 5),
rate-limit backoff until the first real occurrence shows what the error looks like.

## Decisions

1. **Order of the slices:** 3.1 control, 3.2 flow, 3.4 reviewer, 3.3 workers and reassignment.
2. **Pause** stops the shop from starting runs; the ones running finish. Stopping a single run or order is
   a separate action that cancels it. Freezing a live CLI process is not offered: its timers and network
   connections keep running.
3. **Reviewer:** a different engine from the author's, and a gate. The card says "reviewed" only after
   approval, and changes requested trigger one automatic follow-up round before the director is asked.
4. **Conflicts:** the service brings a pull request that conflicts after a merge up to date by itself, once
   per merge, and the director sees it in the logbook. The merge stays the director's. Only conflicts
   trigger it, not a branch that is merely behind: GitHub merges that one fine and each run costs money.
   If the worker cannot resolve it the order blocks and the director takes over.
5. **Chaining (3.2):** an order waits for the orders it declares in `dependsOn` and for earlier signed orders
   whose `likelyFiles` overlap (same path, or one inside the other's folder), until they are delivered or
   discarded. A discarded dependency releases the order. The wait is an event, shown on the card.
