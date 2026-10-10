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

## State on 2026-10-09

- Repository: `rodacato/skynot` (private). `origin` is configured locally. **Nothing has been pushed.**
- Local `main` has 4 commits (skeleton). **All later work is on branch `feat/event-log`** (see
  `git log`). The director will rebase onto `main` and push by hand: a local hook blocks agents from
  pushing or merging into `main`, on purpose.
- GitHub Project: private board "skynot" (#13), linked to the repo. Empty.
- Tests: `npm test` (175 tests) and `npm run typecheck` (server and console) pass.
- Run it without any cost: `npm run build:console`, then `npm run dev`, then open
  `http://127.0.0.1:4747`. Simulated engines, fake GitHub, nothing leaves the machine.
- `policy.yaml` exists locally (untracked) and points at `rodacato/taller-todo`. The tracked template
  is `policy.example.yaml`.

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
| 9 | Real run against the pilot repo | **Not started** |
| Extra | Devcontainer for autonomous work (ADR 0001) | Written, **never built** |

Phase 1 is finished when step 9 works once: from the console, an idea becomes a signed order, a real
worker opens a pull request on `rodacato/taller-todo`, the director merges it, and the minutes are
recorded.

## Next: step 9, the real run

Blockers, in order:

1. **Publish the pilot repo.** `/Users/adriancastillo/Workspace/learning/taller-todo` is a local git repo
   with `.github`, `AGENTS.md`, `src`, `test`, and scripts `typecheck` and `test`. It may have no
   commits yet and has no GitHub repo. Needed: commit, then
   `gh repo create rodacato/taller-todo --private --source . --remote origin`, then the director pushes
   `main`. An agent in this repo cannot do it because its shell is pinned to the skynot directory (see
   "Working agreements"). Either the director runs those commands, or opens a session in that folder,
   or allows `git -C` for that path.
2. **Decide where the real run happens.** Preferred: inside the devcontainer, so the worker's code and
   the `npm ci`, `typecheck` and `test` the service runs on it never touch the host home. That needs the
   devcontainer built and opened for the first time (`.devcontainer/README.md`), the scoped token, and
   logins for `gh`, `claude` and `codex`. Fallback: run on the host and accept the exposure for a toy
   repo.
3. **Engines.** Proposed: Manager and worker both `claude` (`SKYNOT_MANAGER_ENGINE`,
   `SKYNOT_WORKER_ENGINE`). `codex` has no per-command allowlist, so its isolation is weaker; compare it
   later. The real run spends the director's subscription quota (budget per run is in `policy.yaml`).
   Ask before starting it.
4. **Branch protection** on `rodacato/taller-todo` and `rodacato/skynot`, with required pull requests,
   because nothing else stops a bad push to `main` inside the container.

Then: `npm run start`, send a small idea in the console, answer the question, sign, watch it, merge the
pull request on GitHub, record the minutes. Note every surprise in this file.

## Known gaps and limits

- The real `claude` and `codex` CLIs have never been run through this code. Their flags were checked
  against `--help` and the argument builders are unit-tested with a fake process, nothing more.
- Rate limits of the subscriptions are not handled: no backoff, and nobody knows yet what the error
  looks like. `max_parallel` in the policy is the only brake.
- One repository per run: the flow uses the first repo in `policy.yaml` because orders do not belong to
  a project yet. Projects and teams arrive in phase 2.
- A blocked order (verification failed, protected path, budget spent) is recorded in the event log and
  shown in the console, but the Manager does not tell the director in the chat.
- The Manager's chat bubble for an answered question reads "Answer to ...: ..."; it is verbose.
- The console binds to 127.0.0.1 and checks `Host` and `Origin`; there is no login. Fine on a laptop or
  in a container, not for anything exposed. GitHub OAuth behind Tailscale is planned for later.
- No README yet, and `docs/` only holds the vision, this plan and one ADR.
- The pull request check against GitHub is polling (`MergeWatcher`, 30 s). Webhooks are not planned.

## Next after phase 1 (from `docs/vision.md`)

Phase 2: role library, team roster per project, per-role engine and model, hiring, advisors in
parallel. Phase 3: parallel workers, dependency graph, merge queue, independent reviewer. Phase 4: a
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
4. Ask the director which blocker above to take, and what has changed since 2026-10-09.
