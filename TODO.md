# TODO and session handoff

**Temporary.** Nothing else in the repository links to this file; delete it once phase 1 is done.

The director will point a fresh session here. Update this file whenever the state changes.

## Context to load

This file only says where things stand. The rest of the context lives in the other documents; read
them before acting:

- `AGENTS.md`: project rules, language, architecture constraints.
- `docs/vision.md`: what the shop is, roles and teams, architecture, phases.
- `docs/plans/phase-1.md`: the nine steps and the console API shape.
- `docs/adr/0001-devcontainer-for-autonomous-work.md` and `.devcontainer/README.md`: the isolated
  workspace and its security model.
- `policy.example.yaml`: the shape of the policy the shop enforces.

## What this is

skynot is a dev shop of AI agents. The director talks to one agent, the Manager, in a web console. The
Manager turns ideas into work orders, the director signs them, a worker implements each one in a git
worktree, the service verifies the change and opens a pull request, and the director reviews and merges
on GitHub. The pilot goal is to measure how many of the director's minutes each well-solved task costs.
The long-term shape (teams of roles, parallel workers, a game-style office) is in `docs/vision.md`.

## State on 2026-10-10

- Repository: `rodacato/skynot` (private). `main` holds phases 1 to 3. A local hook blocks agents from pushing or merging into
  `main`, on purpose; the director merges.
- Pilot repo: `rodacato/taller-todo` (private) is published, with PR #2 merged by the director. A clone
  of it lives in `examples/taller-todo` (ignored by git and by vitest); it is only a convenience copy.
- GitHub Project: private board "skynot" (#13), linked to the repo. Empty.
- Tests: `npm test` and `npm run typecheck` (server and console) pass.
- Console: the studio (an office per project, the decision desk, work orders, costs with token usage and run
  history). Its guides are `docs/studio-themes.md`, `docs/github-kit.md` and `docs/github-app.md`.
- Run it without any cost: `npm run build:console`, then `npm run dev`, then open
  `http://127.0.0.1:4747`. Simulated engines, fake GitHub, nothing leaves the machine.
- `policy.yaml` and `team.yaml` exist locally (untracked) and are the director's. The tracked templates
  are `policy.example.yaml` and `team.example.yaml`.

## Phase 1 progress (plan in `docs/plans/phase-1.md`)

| Step | What | State |
|---|---|---|
| 1 | Skeleton, architecture test | Done |
| 2 | Event log (JSONL, projections) | Done |
| 3 | Orders context | Done |
| 4 | Governance (policy, guard, action budget) | Done |
| 5 | Execution (engines, parallel scheduler) | Done |
| 6 | Manager | Done |
| 7 | Delivery (worktree, verification, PR) | Done |
| 8 | Console (API, SSE, web client) | Done, walked through in a browser with simulated engines |
| 9 | Real run against the pilot repo | **Done**: three orders delivered, each under 5 minutes of the director's time |
| Extra | Devcontainer for autonomous work (ADR 0001) | Written. The run happened inside a devcontainer, but the ADR's security model (scoped token, hook, branch protection) was not audited |

Phase 1 is finished when step 9 works once: from the console, an idea becomes a signed order, a real
worker opens a pull request on `rodacato/taller-todo`, the director merges it, and the minutes are
recorded.

## Step 9: the real run (2026-10-10)

WO-0001 ("`done <id>`: confirmation and id validation") went from a chat idea to a merged pull request on
`rodacato/taller-todo`. Manager and worker were both `claude`; the worker run took 26 s and cost $0.09
(the log said `claude-haiku-5-5`, but that was a parsing mistake: see the model note below). CI passed.

Surprises, all fixed and committed on `feat/event-log`:

- `spawn sh ENOENT`: the workspace root was relative, so git resolved the worktree path from the clone
  while commands ran from the server cwd. The root is now resolved to absolute. Tests used absolute temp
  dirs, which is why nothing caught it.
- A command timeout killed only the shell, not its children, so a hung `npm test` would never stop. It
  now kills the process group.
- vitest also ran the pilot repo's tests (from `examples/` and `data/`). `vitest.config.ts` excludes them.
- A blocked order had no way out. There is now a `retry-order` command and a Retry button; it reuses the
  issue and does not start the work twice.

Results of the pilot, all with the `claude` worker:

| Order | What | Outcome | Director minutes |
|---|---|---|---|
| WO-0001 | `done <id>` validation and confirmation | PR #2 merged | under 5 |
| WO-0002 | `undo <id>` | PR #5 merged | under 5 |
| WO-0003 | change `package.json` script and add a workflow | Blocked on purpose by `protected_paths`; left on the bench | none |
| WO-0004 | optional due date | PR #7 conflicted with #5, then merged | under 5 |

More things the real run exposed, all fixed on `feat/event-log`:

- A blocked order that already started could not be discarded. A blocked order with no worker on it can
  now be discarded (`abandon`).
- A pull request that conflicts with `main` had no way to be fixed. There is now a `follow-up` command
  and form: the branch is squashed onto the current base (`git merge --squash`), the worker resolves
  conflicts and applies the director's text, and one commit is force-pushed to the same PR. Tried for real
  on 2026-10-10: PR #17 of `taller-todo` conflicted with #16, one follow-up made it mergeable with a
  single commit, no conflict markers, for $0.07.

Branch protection (pull request required) is still not set on either repo: the token has no
Administration permission on purpose, so the director sets it in GitHub settings.

## Known gaps and limits

- `claude` has run once through this code (WO-0001). `codex` never has; its flags were only checked
  against `--help` and unit-tested with a fake process.
- A follow-up squashes the branch, so per-commit history is lost; today each order is one commit anyway.
- The run log used to name the first model in the CLI's `modelUsage`, a small auxiliary one, so every
  earlier run shows haiku. It now names the one that cost the most. Models are chosen per role in `team.yaml`.
- Rate limits of the subscriptions are not handled: no backoff, and nobody knows yet what the error
  looks like. `max_parallel` in the policy is the only brake.
- One repository per run: the flow uses the first repo in `policy.yaml` because orders do not belong to
  a project yet. Projects and teams arrive in phase 2.
- The Manager's chat bubble for an answered question reads "Answer to ...: ..."; it is verbose.
- The console binds to 127.0.0.1 and checks `Host` and `Origin`; there is no login. Fine on a laptop or
  in a container, not for anything exposed. GitHub OAuth behind Tailscale is planned for later.
- No README yet, and `docs/` only holds the vision, this plan and one ADR.
- The pull request check against GitHub is polling (`MergeWatcher`, 30 s). Webhooks are not planned.

## Phase 2 progress (plan in `docs/plans/phase-2.md`)

| Slice | What | State |
|---|---|---|
| 1 | Engine and model per role in `team.yaml` | Done and tried with the real `claude` (Sonnet on the developer) |
| 2 | Advisors consulted in parallel by the Manager | Done and tried once with the real `claude`: one consultation took the order from "scalable storage" to a SQLite-only order with a frozen fixture, for about $0.22 against $0.03 for a plain turn |
| 3 | Team changes with the director's signature (library, `RosterProjection`, Sign and Discard in the console) | Built, and tried once with the real `claude`: the Manager proposed hiring the designer for a wording task, the director signed, the next turn consulted the designer and got a concrete message guide, for about $0.14. Built on the director's call, without a pain shown |

Things to know:

- A rejected Manager answer is retried. One cause (options over 40 characters) was found by reproducing
  the call and the prompt now states the limit; the reason of every rejection is now logged as
  `manager.answer_rejected` and shown in the logbook.
- Whether the advisors are worth their cost in daily use is still open. Removing the `advisors` section
  of `team.yaml` turns them off.
- WO-0007 (SQLite backend) was proposed during that test and may still be waiting for a signature.

## Phase 3 progress (plan in `docs/plans/phase-3.md`)

| Slice | What | State |
|---|---|---|
| 3.1 | Control: stop a run or an order, pause and resume the shop, costs per order and per day, daily cap | Built. Stop tried with the real `claude` (a run aborted after 3 s, no process left); pause and the cap only in tests |
| 3.2 | Flow: `dependsOn`, chaining by shared files, automatic update of conflicting pull requests | Built and tested with fakes; not tried with the real CLIs |
| 3.3 | Several workers (`workers` in `team.yaml`) and reassigning an order from its card | Built and tested with fakes; not tried with the real CLIs |
| 3.4 | Independent reviewer on another engine, as a gate, and CI status | Built; the verdict path was tried with the real `codex` on a real diff (12 s), not yet end to end in the shop |

Controls in the console: Stop next to every working or waiting run and on an order being worked, Pause
and Resume in the header, today's cost against the cap, and what each order has cost. The daily cap is
`run_budget.max_usd_per_day` in `policy.yaml` (optional; a day is the UTC day). Stopping blocks the order
as "stopped by the director", so it can be retried or discarded.

## Phase 4 progress (plan in `docs/plans/phase-4.md`)

| Slice | What | State |
|---|---|---|
| 4.1 | `projects/<name>/` with `project.yaml`, optional `team.yaml` and `briefing.md`; ports `ProjectCatalog`, `BriefingStore`, `TeamRepository` with yml adapters; the Manager reads the briefing | Built; tried with the real `claude`, which used facts that only the briefing held. The director's own setup still runs from `policy.yaml` and `team.yaml` (the fallback); move it to `projects/` when ready |
| 4.2 | Orders, chat, team, runs and costs belong to a project; a desk per project | Built, tested with fakes |
| 4.3 | One inbox: Manager questions and worker questions (`QUESTION:`) | Built, tested with fakes |
| 4.4 | Intake from labelled issues; board mirror (`gh project`), one way | Built, tested with fakes. The board's write permission checked read-only (`viewerCanUpdate`); no card has been moved yet |
| 4.5 | Console: project selector, inbox, per-project readiness | Built |
| 4.6 | The Manager proposes a new briefing or a new focus for an advisor; the director signs | Built, tested with fakes |

## Readiness

`npm run check` (and the banner in the console) lists what is missing: CLI logins, the `codex` sandbox, token
permissions, push access and branch protection. Write access to issues and pull requests cannot be probed
without writing, so it is only found on first use. Known in this devcontainer: the Docker seccomp profile blocks
the user namespaces `codex` needs, so its reviewer reads the diff but cannot run tests.

## Blocked orders

A blocked order is announced by the Manager in the chat, with what to do next. When the worker touches
protected files, the director can approve exactly those files from the order's card; the next run may
touch them and no others, and the approval is an event in the log. If the blocked order is in review, the
approval only records the files and the director sends the follow-up again. Pushing a change to
`.github/workflows/` still needs the Workflows permission on the GitHub token.

## Next after phase 2 (from `docs/vision.md`)

Phase 3: parallel workers, dependency graph, merge queue, independent reviewer. Phase 4: a
GitHub organization and machine account, and the shop builds a todo app from an empty repo. Phase 5:
curated memory, heartbeat, daily report. Phase 6: deploy on the KVM VM behind Tailscale, and Telegram.

Open questions: organization plus machine account or GitHub Apps; terms of use for automating the
`claude` and `codex` CLIs on subscriptions; default `max_parallel`; license.

## Where things are

| Path | What |
|---|---|
| `src/kernel` | Clock, ids, Result, event log and stores, projections, process execution |
| `src/orders` | Work order lifecycle, spec schema, card |
| `src/governance` | `policy.yaml` schema, guard, action budget |
| `src/execution` | Engine port, claude and codex adapters, fake engine, run scheduler |
| `src/manager` | Chat, questions, the model contract and retries |
| `src/delivery` | Issue and PR text, git workspace, `gh` adapter, issue filer, implementer |
| `src/app` | Composition: `shop.ts`, order flow, merge watcher, HTTP API (`http/`), `main.ts`, mock engines |
| `console/` | Vite and Preact client, a thin view over `/api` |
| `test/` | Mirrors `src`; `test/architecture` enforces the dependency rules |
| `policy.example.yaml` | Tracked template; the real `policy.yaml` is untracked |
| `.devcontainer/` | Isolated workspace, see its README |

Rules the architecture test enforces: the domain imports no adapter, contexts do not import each
other (they define ports), `src/app` may import only a context's public `index`.

## Working agreements

- Chat with the director in Spanish. Everything in the repo (code, commits, docs, UI, prompts) in
  English.
- Commit locally and stop. Never push, merge or open a pull request unless asked, and never push to
  `main`: the director does that.
- No `Co-Authored-By` or AI attribution in commits, issues or pull requests.
- Do not use `rm -rf`. Do not stash or switch branches with a dirty tree; use `git worktree`.
- The director's tooling may restrict `cd`, `git -C` and command chains to one simple command per call.
  A subagent's shell is fixed to the directory the session started in, so it cannot operate in another
  repository.
- Tests use real objects and temp directories; mock only boundaries we do not own (the CLIs, GitHub,
  the clock). No fixed sleeps in tests: wait on a condition.
- Match ceremony to complexity; do not add a dependency or layer without a concrete pain it solves.

## Session start checklist

1. Read the documents listed under "Context to load".
2. `git status`, `git branch -vv`, `git log --oneline -5`.
3. `npm run typecheck` and `npm test`.
4. Ask the director what has changed since 2026-10-10 and what to take next.
