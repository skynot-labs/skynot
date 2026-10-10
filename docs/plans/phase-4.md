# Phase 4 · Several projects, a board, and questions that reach the director

**Status:** plan approved by the director; slice 4.1 built, 4.2 to 4.6 not started. See [vision](../vision.md) and [phase 3](phase-3.md) for
what exists.

## Why

The shop serves one repository with one team. `policy.yaml` accepts a list of repositories, but the code always
takes the first; `team.yaml` is global; orders, chat, runs and costs do not say which project they belong to. The
vision promises "a team per project". The director wants several projects at once, each with the roles that fit it,
a place for what must not go in a project's repository, work taken from GitHub instead of only from the chat, and
one place that says what is waiting on them.

The director judged the dev-shop coverage of phase 3 enough (see the last section). What is missing is project
management: where work comes from, and what needs a human decision.

## Decisions taken

1. **The repository is the source of context.** Vision, architecture and conventions live in the project's repo
   (`AGENTS.md`, `docs/`), where every agent already reads them. The shop keeps only what must not go there:
   the team, the director's rules for that project, and a private briefing.
2. **One folder per project in the shop**, `projects/<name>/`, configured in yml: `project.yaml` (repository, base
   branch, verification, protected paths), `team.yaml`, `briefing.md`, and the souls of its roles. `policy.yaml` stays
   the director's and global: limits, daily cap, labels.
3. **Ports first, no database.** Each context defines the port it reads through (`ProjectCatalog`, `TeamRepository`,
   `BriefingStore`) and the yml adapter implements it. State stays in the event log, which is already the shop's
   database. A database adapter is written when a concrete pain asks for it, and nothing in the domain changes.
4. **Changes to a project's setup go through events**, as hiring does today: yml is the baseline, signed proposals
   are applied from the log.
5. **Greenfield moves to phase 5** and everything after it down one number. The project id is the folder name; the
   repository is a field of `project.yaml`. A conversation with the Manager per project, one Manager definition,
   the briefing is the difference. Events written before projects existed belong to the first project, with no
   migration of the log.
6. **The board and the tickets feed the Manager; they never start work by themselves.** Anything that comes from a
   ticket becomes a proposed order the director signs, like everything else.

## Slices

Each is delivered and tried before the next is planned in detail.

**4.1 · Project folder and ports, with one project.** `ProjectCatalog`, `TeamRepository`, `BriefingStore` and their
yml adapters. The shop reads the single existing project through them, moving `policy.yaml`'s `repos[0]` and
`team.yaml` into `projects/<name>/`; a shop with the old files keeps working until the director moves them. The
Manager's prompt includes the briefing. **Done when** the Manager cites something written only in `briefing.md`, and
the code no longer touches `repos[0]`.

**4.2 · State per project.** Every order, run, chat message and cost carries a project. Projections filter by it;
order ids are unique per project. One conversation with the Manager per project. **Done when** two projects run
orders at the same time without sharing a chat, a queue position that confuses them, or a cost.

**4.3 · The director's inbox.** One list of what waits for the director, each item with who raised it, the project,
and the order or ticket it concerns: the Manager's questions (today in the chat), a doubt about a ticket before an
order exists, a question an advisor or the reviewer raises, and a worker that stops to ask instead of guessing.
Answering sends the answer back to whoever asked: the Manager continues, a worker resumes as a follow-up. Typed
events (`inbox.question_raised`, `inbox.answered`); the model proposes the question, the code validates its shape.
A header badge says how many wait. How a worker raises a question reliably (a structured final answer, not text
the service has to guess) is decided when the slice starts. **Done when** a worker that is missing a decision stops,
the question shows in the inbox with its order, and the answer resumes the same order.

**4.4 · Intake from GitHub.** The Manager reads tickets and proposes orders from them. First from issues carrying a
label (`skynot:ready`, within the policy's label prefix), which works with the token the shop already has; the
project's board follows if its columns can be written with that token (reading it works today, writing is
untested). The shop moves the card as the order advances (proposed, in progress, in review, done); the event log
stays the truth and the board a view, so the sync goes one way. A ticket the Manager cannot turn into criteria goes
to the inbox as a doubt, not to a guess. **Done when** an issue labelled by the director appears as a proposed order
with its criteria, or as a question in the inbox, and its card follows the order to Done.

**4.5 · Console and per-project team.** A project selector, each project's team, cost and what waits on the director,
readiness checks per repository (the existing `npm run check`, once per project). Scheduling stays global:
`max_parallel` is the shop's, not a project's. A per-project daily cap is read from `project.yaml` when it exists.

**4.6 · Changing a project without editing files.** The Manager proposes changes (add a role, change a soul's
focus, update the briefing) and the director signs. Editing yml by hand keeps working.

The order is open to change after 4.2: if the inbox or the intake hurts more than the selector, they go first.

## Coverage of a dev shop

The director judged what the shop does today enough for a dev shop, and wants project management on top, which
is this phase. Gaps that were considered and left out, each with the evidence that would bring it back:

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

Sprints, story points, estimation sessions, daily stand-ups and burndown charts are deliberately absent: no pain asks
for them.
