# Phase 2 · Roles and teams

**Status:** slice 1 and slice 2 are built; slice 3 is not planned in detail yet. See [vision](../vision.md) for the
context and [phase 1](phase-1.md) for what exists.

## Why, and why in slices

The vision describes phase 2 as a role library, a team roster per project, engine and model per role,
hiring, and advisors in parallel. The pilot gave evidence for only one of those: the model of each run
was whatever the CLI picked and there was nowhere to choose it. (The run log first reported
`claude-haiku-5-5` for every run; that was a parsing mistake, the CLI lists a small auxiliary model
before the one that did the work.) The rest has no demonstrated pain yet, so the phase ships in three
slices, each delivered and tried before the next is planned in detail.

## Slice 1 · Engine and model per role

The engines and the runners already accept a model (`--model` for `claude`, `-m` for `codex`); only the
configuration is missing. Today the engine comes from two environment variables and the model cannot be set.

- A new `team` context. Domain: `Role` (name, kind worker or advisor, engine, model) and `Roster`.
  Adapter: reads `team.yaml`, validated with zod. Unknown role, engine or field fails at startup with a
  message that names it.
- `src/app` wires the roster into the Manager and worker runners. `SKYNOT_MANAGER_ENGINE` and
  `SKYNOT_WORKER_ENGINE` are removed: one source of truth, not two.
- The console's presence shows each role's engine and model.

**Done when:** editing `team.yaml` changes the engine and model of the next Manager and worker runs,
`execution.run_completed` in the log shows the model that actually answered, and a typo in the file
stops the service before it spends anything.

## Slice 2 · Advisors in parallel

- Advisors are read-only roles that deliver a document: architect, reviewer, and later designer and
  domain expert. Each has a short soul (personality, expertise, what it must deliver) kept in a markdown file.
- The Manager's answer gains a typed `consult` operation: a list of `{ role, question }`. The service
  runs the advisors at once through the existing scheduler, in read-only mode on a fresh copy of the
  repository, and hands the answers back to the Manager, who then proposes the order or asks the director.
- Advisor answers are events in the log and show in the logbook. They are not posted to GitHub yet.

**Done when:** one idea makes the Manager consult two advisors at the same time, their answers appear in
the logbook, and the resulting order reflects them.

## Slice 3 · Team and hiring

The Manager proposes a team for a project and the director signs it, or the Manager hires within limits
set in `policy.yaml` (allowed roles, maximum size). Events `TeamProposed` and `TeamSigned`. Planned in
detail after slice 2, because it depends on what the advisors turn out to be worth.

## Not in phase 2

Parallel workers, dependency graph, merge queue and the independent reviewer of code (phase 3); a
second repository per shop and the organization (phase 4); journals and curated memory (phase 5). The
role library stays a folder of markdown files until a second project needs a different roster.

## Open decisions

1. **Where `team.yaml` lives.** Proposed: `team.example.yaml` tracked and `team.yaml` untracked, the
   same as `policy.yaml`, because the pilot has one repository. A roster per project waits for a second one.
2. **Who may edit it.** Proposed: only the director, like the policy; the Manager can propose a change
   in slice 3 and never apply it.
3. **Default model.** Proposed: when a role names no model, the CLI's own default applies and the log
   records which one it was. No hidden default in our code.
