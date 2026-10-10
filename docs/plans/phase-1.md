# Phase 1 · Web console and the new core

**Status:** done. Step 9 ran on 2026-10-10: three orders were delivered on `rodacato/taller-todo`, each
under 5 minutes of the director's time. See [vision](../vision.md) for the context.

**Left out on purpose:** the Manager's `write_memory` and `append_journal` operations and the memory
repo (phase 5), and the `pause` and `resume` commands of the API. The Manager answers with a message, a
question or an order, nothing else.

## Goal

The director runs the whole flow from a web console, with no terminal: chat with the Manager, see work orders, sign them, follow the logbook and answer decisions. Underneath, the new architecture exists in miniature: bounded contexts, ports and adapters, domain events, an append-only event log, and a run queue with a concurrency limit.

Done when: from the console, `idea → work order card → signature → issue → worker run in a worktree → PR → delivered → minutes` works against a fake GitHub, and once against the real pilot repo, and every step shows up in the event log.

## Slices

Each slice ends green (typecheck, tests, dependency rules) and is committed on its own.

1. **Skeleton.** Node 22, strict TypeScript, Vitest, zod, yaml. Shared kernel (ids, clock, result type). Dependency rule enforced by a test or dependency-cruiser: domain imports no adapter. First commit also carries the vision.
2. **Events.** `DomainEvent` envelope, in-process bus, `EventStore` port with a JSONL file adapter and an in-memory one. Projections rebuilt from the log at startup.
3. **Orders context.** `WorkOrder` aggregate and states (drafted, awaiting signature, signed, on the bench, in review, delivered, discarded), zod schema, card rendering, events, and the ledger as a projection.
4. **Governance context.** `policy.yaml` schema and guard: allowed repos, label prefix, limits per order and per day, protected paths, `max_parallel`. Edited only by the director.
5. **Execution context.** `RoleRun` aggregate, `RoleEngine` port, claude and codex adapters (ported from v0), a fake engine, and a run queue honouring `max_parallel` with visible queue position, login checks that spend no quota, and no automatic retries.
6. **Manager.** Application service: a chat message goes to the Manager role, the answer is validated against a schema and turned into typed operations the guard approves (`ask_director`, `propose_order`, `write_memory`, `append_journal`). Invalid answers go back to the model twice, then become a question to the director.
7. **Delivery context.** `Vcs` and `Workspace` ports with fake and `gh`/git adapters (ported from v0). A worker run in an isolated worktree, verification run by the service, commit, push and PR by the service.
8. **Console.** HTTP and SSE server in the same process, plus a plain thin client. Commands in, projections and the event stream out. Views: chat, work orders, logbook, decisions inbox, agent presence.
9. **Real run.** The same flow against the pilot repo with the real engines, one small order.

## Console API shape

The decoupling that lets a game-style office come later:

- **Commands:** `POST /commands/<name>` (send message, sign order, answer decision, pause, resume).
- **Read models:** `GET /state/orders`, `/state/logbook`, `/state/decisions`, `/state/presence`.
- **Stream:** `GET /events` over SSE, replaying from a cursor.
- The UI holds no business rules and talks to nothing else.

## Salvage from `skynot-v0`

Port, with tests, adapting to the new layout: `src/engine` (claude, codex, schemas, exec), `src/workspace/git.ts`, `src/github` (gh gateway and fake), `src/orders` (schema, card, ledger), `src/policy`, `src/memory`. Left behind: the orchestrator `src/core`, Telegram, the dev chat page, the step-0 boards, the old ADRs.

## Decisions

- **Server and client stack.** Hono for HTTP and SSE, and a small static client in plain TypeScript with Preact, built with Vite. No component library.
- **Language.** English for everything: code, docs, console, agents.
- **Memory repo location** for phase 1: a local git directory seeded from templates, as in v0; the separate remote memory repo waits.
- **Pilot repo.** `taller-todo` stays as it is for phase 1 and is only published as a private repo under `rodacato` at step 9, when the real run needs it. The empty-repo, built-by-the-shop todo app is phase 4, in the shop's own organization.
- **Project repo.** `rodacato/skynot` is private and already exists; `origin` is configured locally. Nothing is pushed until the director says so.

## Not in phase 1

Teams and the role library (phase 2), parallel workers and the independent reviewer (phase 3), the organization and machine account (phase 4), curated memory and heartbeat (phase 5), Telegram and deployment (phase 6), and anything game-like.

Concurrency is built into the queue now, but only the Manager and a single worker use it.
