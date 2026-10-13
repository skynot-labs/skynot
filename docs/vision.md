# skynot · Vision

**Status:** draft for discussion. Items marked *(proposed)* are not yet confirmed by the director.

## What we are building

A dev shop made of AI agents. The director talks to one agent, the **Manager**. The Manager runs **teams**: each project gets the roles it needs (an architect, a designer, a domain expert, two developers, a lead, a reviewer…), each with its own personality, expertise and memory. Together they turn what the director asks for into working software, whether it is a **new project** or the **maintenance of an existing one**.

The first test case is a todo app built from an empty repository, to validate the whole flow: idea, team, plan, parallel work, review, delivery.

What we want to validate first, before any infrastructure: **the product code, and the handling of agents with their memories.**

## Principles

- **State outside the LLM.** GitHub and the memory repo are the memory; no agent "remembers".
- **The LLM proposes, the code validates.** Agents act only through typed operations the service checks against `policy.yaml`.
- **Roles differ by tools and deliverables**, not only by personality. A role with the same tools as another is theater.
- **Agents talk through artifacts** (issues, PR comments, files in the repo), never through free-form chatter. It is cheaper and auditable.
- **The one who writes code never approves it.**
- **Fast to start, fast to measure.** Parallelism is part of the first versions, not a later optimisation.

## How the shop talks to the director *(proposed)*

The director brings an idea and what they want from it. They may be technical or not; the shop never needs them to be.

- **The director decides what and why; the shop decides how.** The Manager asks about outcomes, limits and taste. A technical choice is settled with the architect. When it cannot wait, the Manager takes the option that is easiest to undo and says what it assumed.
- **Shape, do not block.** The Manager turns an idea into something the shop can build within what the project already is. It names the risks and what each option costs, in plain words, and keeps going unless the risk is the director's to take: money, data, something public, something that cannot be undone.
- **Every piece of work has two layers.** The *explanation* is what the director reads: what they will get, what it costs, what could go wrong. The *brief* is what the team works from: context, technical approach, acceptance criteria, files, dependencies. The brief is always one click away, and the director reads it only when they care to.
- **The brief is a draft until it is signed.** It grows while the Manager talks with the director and consults the team, so nothing has to be decided again when the work starts. A signature freezes it: what was signed is what gets built, and a later change is a new proposal.
- **Acceptance criteria are never optional, and never the director's homework.** They are how the service, the worker and the reviewer know the work is done. There is no separate definition of done: the criteria and the project's verify commands are it.
- **The director signs a plan, not each order.** One idea can need several orders, with a sequence and a priority among them. The Manager presents the plan; the director signs it, or says what to change and gets a revised one. How it is split is the shop's business.

What this replaces: today the Manager asks whenever a request has two readings, technical ones included, consults advisors only when it must, and proposes one order at a time.

## Shape of the system

```
console (web)  ──API / event log──▶  orchestrator  ──▶ role runs (CLI subprocesses)
 chat with the Manager               policy, queue,       claude / codex, one worktree
 work orders, logbook, decisions     memory, GitHub       per worker, read-only for advisors
```

- **Console** is a thin client: the studio where the team is seen working, chat with the Manager, work orders, logbook, pending decisions. It only talks to the orchestrator's API and event log, so Telegram (roadmap) can be added without touching the core. It can also be published on its own and paired with an office elsewhere, behind a session ([connecting a studio](connecting-a-studio.md)).
- **Orchestrator and roles run together**, in one deployable service. Roles are memory folders plus the engine that runs them, not separate deployments.
- **Hosting:** the office runs on one machine, the director's own or a [server](running-on-a-server.md). The studio is either the console that office serves or the public one on GitHub Pages, paired with it.

## Architecture

Hexagonal, light DDD, event-driven.

- **Bounded contexts:** Orders (work order lifecycle), Team (roles, rosters, hiring), Execution (role runs, queue, concurrency, engines), Delivery (worktrees, verification, GitHub, PRs), Governance (policy and limits), Manager (the conversation with the director and what comes out of it), Projects (the repositories a shop works on). Memory (the memory repo) is planned, not built.
- **Three packages:** `packages/office` is the service, `packages/studio` the console in the browser, and `packages/contract` what the two exchange: the state, the commands and the event stream, as schemas with a version. The studio knows the office only through the contract ([ADR 0002](adr/0002-studio-office-and-a-contract.md)).
- **Layout of the office:** `packages/office/src/<context>/{domain,application,adapters}` plus a small shared kernel. The domain never imports an adapter; `test/architecture` enforces it, along with the boundaries between the packages.
- **Outbound ports:** `RoleEngine` (adapters: claude CLI, codex CLI, fake), `Vcs` (gh, fake), `Workspace`, `MemoryStore`, `EventStore`, `Clock`. **Inbound:** web console over HTTP and SSE; Telegram later.
- **Domain events** (`OrderDrafted`, `OrderSigned`, `TeamProposed`, `RoleRunStarted`, `RoleRunCompleted`, `VerificationFailed`, `PullRequestOpened`, `OrderDelivered`) go through an in-process bus and an append-only JSONL log. The log feeds the console, the logbook and the ledger, and coordinates the flow between contexts. State is rebuilt from the log at startup; no full event sourcing and no database at first.
- **Light DDD:** aggregates only for the work order and the role run. Ubiquitous language in English. No empty layers.
- **shellm** (the director's CLI-as-API gateway) is **not** integrated: it runs each request in an empty, read-only temp directory, so it cannot serve workers or repo-reading roles. It may become an optional `RoleEngine` adapter for pure prompt-to-answer calls. Its ideas are taken: a cap on concurrent CLI processes, a visible queue, login checks with `claude auth status` and `codex login status` that spend no quota, no automatic retries, per-run cost.

## The game-style office

The product started from the idea of looking like a management game in the spirit of Game Dev Tycoon: an office where the team works and the director watches and decides. The console is that office since the flow was validated in phase 1. It stays a client like any other:

- The console is a thin client. All logic lives behind the API, and the UI only renders projections and sends commands.
- Who is at a desk, working or waiting for the director comes from the state the API exposes (role, status, current order), never from an animation.
- How a studio or an avatar looks is a preference kept in the browser. It changes no role, permission, schedule or cost.

## Roles and teams

- **Role library.** Each role is a reusable definition: soul, expertise, allowed tools, default engine and model.
- **Team roster per project.** A `team.yaml` per project says which roles are on the team and how many instances of each. Instances of one role share its definition and the project memory, and each keeps its own journal.
- **Workers and advisors.**
  - *Workers* write code in an isolated git worktree and open PRs (developers).
  - *Advisors* are read-only and deliver a document, a comment or a decision (architect, designer, domain expert, sales, reviewer). They are cheap to run in parallel and never cause code conflicts.
- **Hiring.** Two modes, chosen per project in `policy.yaml`:
  - The Manager proposes a team and the director signs it.
  - The Manager hires on its own, within limits the director sets (allowed roles, maximum team size).
  - In both modes the director can ask to add a role at any time, and the Manager can propose one when it sees a bottleneck.
- First test team: Manager, architect, two developers, reviewer. Designer and domain expert join once the base flow works.

## Engines and models

Both subscriptions are used through their CLIs (`claude` and `codex`) with the director's own logins, no API keys. The engine and model are set **per role**, so roles can run on different models and be compared on the same work orders. The terms of use for automated CLI use still need to be reviewed.

## Parallelism

- **Advisors in parallel** at the start of a project or work order: the Manager consults architect, designer and domain expert at once and merges their answers.
- **Workers in parallel**, one worktree each. The limit is a number in `policy.yaml` (`max_parallel`), set as high as the subscriptions allow, with backoff when a CLI reports rate limits. We measure and adjust.
- **Avoiding collisions.** Each work order declares its probable files and its dependencies. Orders that touch the same files are chained instead of run in parallel. Merges go through a queue.
- **Two kinds of subagent.** Ephemeral subagents inside one CLI run (research, reading) leave no trace. Anything that writes code or leaves memory is a shop agent, with identity, worktree and a line in the ledger.

## Memory

Three levels, all markdown in a separate memory repo, every change a commit:

1. **Role memory:** what the role knows about its craft.
2. **Project memory:** what the team knows about one repo.
3. **Instance journal:** daily log of one agent; today and yesterday are loaded, the rest is searched. Important items are promoted to curated memory; curated memory has a size ceiling and is consolidated, not appended forever.

No secrets in memory. Each important note links its source (issue, PR or director message). Memory never changes policy.

## GitHub *(proposed)*

- A **dedicated GitHub organization** for the shop, owned by the director's account. Project repos live there, private when wanted, with CI, lint and tests in Actions.
- A **machine account** inside the organization, used through `gh`, as the shop's identity. The shop can already act as a [GitHub App](github-app.md) instead; whether a bot approval satisfies branch protection is still to be validated.
- The reviewer's approval must come from a different identity than the author's.
- GitHub Projects boards for dashboards, to be confirmed as supported for the chosen identity.

## Phases

| Phase | Outcome | Done when |
| --- | --- | --- |
| 0 (done) | Vertical slice: idea, card, signature, issue, PR, minutes | Works with mocks and real git |
| 1 (done) | Web console: chat with the Manager, work orders, logbook, decisions, over an event log | The whole flow runs without the terminal |
| 2 (done) | Role library, team roster, per-role engine and model, hiring, advisors in parallel | The Manager proposes a team and consults advisors at once |
| 3 (done) | Parallel workers, dependency graph, merge queue, independent reviewer | Two developers deliver two orders at the same time, reviewed by someone else |
| 4 (done) | Several projects, each with its own team, work taken from GitHub, and an inbox of what waits for the director | Two projects run at once, and a labelled issue becomes an order the director signs |
| 5 (in progress) | A public studio and an office anyone can run: a contract between the two, pairing, one setup command, a demo in the browser | A newcomer goes from the README to a shop answering in under ten minutes |
| 6 | Greenfield: organization, machine account, the Manager creates the repo with CI, lint and tests | The todo app is built from an empty repository, then extended and fixed |
| 7 | Curated memory, heartbeat, daily report | The Manager applies an earlier answer to a similar order without asking again |
| 8 | Telegram | The director runs the shop without opening the console |

Phase 5 has the contract, the session and the published studio ([ADR 0002](adr/0002-studio-office-and-a-contract.md)); the setup command and the demo are open issues. It also took the place of a deploy phase: an office already runs on a [server](running-on-a-server.md).

## Not included for now

Autonomy levels per task type, voice notes, local models, and any framework for multi-agent orchestration.

Sprints, story points, estimation sessions, daily stand-ups and burndown charts are absent on purpose: no pain asks for them.

Parts of a dev shop that were considered and left out, each with what would bring it back:

| Area | Not built | Trigger |
| --- | --- | --- |
| Revert | An operation to undo a merge | The first merged order that has to be reverted |
| Release and deploy | Versions, changelog, staging, rollback | The first project that ships to someone |
| Dependencies and security | Scheduled updates, audit, secret scanning | A vulnerable or stale dependency found by hand |
| Quality beyond tests | Coverage, browser tests, accessibility | A web project whose bugs the unit tests miss |
| Architecture records | The architect's answer written to `docs/` | An architectural question asked twice |
| Flow metrics | Lead time, review rounds, rework per order | Wanting to compare two workers on the same orders; the data is already in the log |
| Operations | Error tracking, uptime, incidents | A project in production |
| Rate limits | Backing off when a subscription says no | The first occurrence |
| Queue | Priorities and reordering | A queue deeper than `max_parallel` |
| Merge | The shop merging by itself under a policy: low risk, approved by the reviewer, checks green, verified on the current base; never money, auth, a schema or a large diff | The director merging low-risk orders without reading them |
| Per-project daily cap | A cap read from `project.yaml` | One project spending another's day |

## Open questions

- Confirm the organization plus machine account, or use GitHub Apps from the start.
- Confirm that `taller-todo` stays nearly empty so the shop builds the app.
- Terms of use for automated use of the `claude` and `codex` CLIs on subscriptions.
- Default `max_parallel` and how rate limits are detected for each CLI.
