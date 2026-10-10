# Phase 4 · Several projects, each with its own team

**Status:** draft for the director. Nothing here is built. See [vision](../vision.md) and [phase 3](phase-3.md) for
what exists.

## Why

The shop serves one repository with one team. `policy.yaml` accepts a list of repositories, but the code always
takes the first; `team.yaml` is global; orders, chat, runs and costs do not say which project they belong to. The
vision promises "a team per project". The director wants several projects at once, each with the roles that fit it,
and a place for what must not go in the project's repository.

## Decisions already taken

1. **The repository is the source of context.** Vision, architecture and conventions live in the project's repo
   (`AGENTS.md`, `docs/`), where every agent already reads them. The shop keeps only what must not go there:
   the team, the director's rules for that project, and a private briefing.
2. **One folder per project in the shop**, `projects/<name>/`, configured in yml (the director likes it):
   `project.yaml` (repository, base branch, verification, protected paths), `team.yaml`, `briefing.md`, and the
   souls of its roles. `policy.yaml` stays the director's, global: limits, daily cap, labels.
3. **Ports first, no database.** Each context defines the port it reads through (`ProjectCatalog`, `TeamRepository`,
   `BriefingStore`) and the yml adapter implements it. State stays in the event log, which is already the shop's
   database. A database adapter is written when a concrete pain asks for it, and nothing in the domain changes.
4. **Changes to a project's setup go through events**, as hiring does today: yml is the baseline, signed proposals
   are applied from the log.

## Slices

Each is delivered and tried before the next is planned in detail.

**4.1 · Project folder and ports, with one project.** `ProjectCatalog`, `TeamRepository`, `BriefingStore` and their
yml adapters. The shop reads the single existing project through them, migrating `policy.yaml`'s `repos[0]` and
`team.yaml` into `projects/<name>/`. The Manager's prompt includes the briefing. Nothing visible changes except
that the briefing exists. **Done when** the Manager cites something written only in `briefing.md`, and the code no
longer touches `repos[0]`.

**4.2 · State per project.** Every order, run, chat message and cost carries a project. Projections filter by it;
ids stay unique per project (`WO-0001` in each). Old events without a project belong to the first project. One
conversation with the Manager per project. **Done when** two projects run orders at the same time without sharing
a chat, a queue position that confuses them, or a cost.

**4.3 · Console and per-project team.** A project selector, each project's team and costs, readiness checks per
repository (the existing `npm run check`, once per project). Scheduling stays global: `max_parallel` is the
shop's, not a project's.

**4.4 · Changing a project without editing files.** The Manager proposes changes (add a role, change a soul's focus,
update the briefing) and the director signs. Editing yml by hand keeps working.

## What a dev shop does that we do not yet cover

Listed so that each gap is decided on purpose. "Trigger" is the evidence that would justify building it; none
is a phase 4 commitment.

| Area | What shops do | Today | Trigger to build it |
| --- | --- | --- | --- |
| Intake | Take work from issues filed by people or by users, not only from the chat | Only the director's chat | The director files an issue by hand and wishes the shop had picked it up |
| Backlog | Prioritise, group in milestones | Orders are a flat list; the queue is never deep | A queue deeper than `max_parallel` for a week |
| Revert | Undo a bad merge fast | Nothing; the director reverts on GitHub | The first merged order that has to be reverted |
| Release | Version, changelog, tag, release notes | Delivery ends at the merge | A project that is released to someone |
| Deploy | Staging, production, rollback, migrations | None | The first project that is deployed (phase 6 in the vision) |
| Dependencies and security | Scheduled updates, audit, secret scanning | None; GitHub's own tools if enabled | A vulnerable or stale dependency found by hand |
| Quality beyond tests | Coverage, end-to-end and browser tests, accessibility, performance | Verification commands only | A web project whose bugs the unit tests do not catch |
| Architecture records | A short ADR per decision | The architect's answer lives in the logbook | An architectural question asked twice |
| Observability | Metrics of the flow: lead time, review rounds, rework, cost per order | Raw events; cost per order and per day | Wanting to compare two workers or two engines on the same orders (the data already exists in the log) |
| Operations | Error tracking, uptime, incidents, post-mortems | None | A project in production |
| Rate limits | Back off when a subscription says no | Never observed, error text unknown | The first occurrence |
| Reports | Status for the client | The console | A second person who needs to know where things are |

Deliberately not on the list, because they exist to look like progress and no pain asks for them: sprints,
story points and estimation sessions, daily stand-ups, and burndown charts. Anything of that kind needs a documented
trigger first.

The two cheapest to add once the phase is under way, because the data or the pattern already exists: flow metrics
(a projection over the log) and architecture records (the architect's deliverable written to `docs/` in the project's
repository).

## Open decisions

1. **The vision's phase 4 is greenfield** (the Manager creates a repository with CI and lint from nothing). This plan
   takes the number for several projects; greenfield becomes phase 5 and memory, deploy and Telegram move down one.
   Proposed, because greenfield builds on having a project to create. Needs the director's call and a change to the
   vision's table.
2. **One Manager per project or one shared.** Proposed: a conversation per project, one Manager definition, and the
   briefing as the difference.
3. **Where the briefing may be edited.** Proposed: the file, and a Manager proposal the director signs in 4.4.
4. **Project name and id.** Proposed: the folder name, lowercase, as the id; the repository stays a field of
   `project.yaml`, so one repository could serve two projects later without a rename.
5. **Existing events.** Proposed: events without a project belong to the first project, with no migration of the log.
