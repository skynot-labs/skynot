# skynot

A dev shop of AI agents. The director talks to one agent, the Manager, who runs per-project teams of roles (architect, designer, developers, reviewer...) that turn requests into delivered software. Read `docs/vision.md` first, then the current plan in `docs/plans/`.

## Language

Everything in the repo is English: code, comments, commits, issues, PRs, docs, console copy, agent prompts.

## Architecture

Hexagonal, light DDD, event-driven. Details in `docs/vision.md`.

- `src/<context>/{domain,application,adapters}` for each bounded context, plus `src/kernel` for the small shared kernel.
- The domain imports no adapter and no other context's internals. A test enforces it; keep it green.
- Contexts talk through ports they define themselves. `src/app` is the composition layer: it wires adapters between contexts and may import only a context's public `index`.
- Agents act only through typed operations that the service validates against `policy.yaml`. The LLM proposes, the code validates.
- State changes are domain events appended to a JSONL log. Clients (the console and its studio view, later Telegram) only send commands and read projections.

## Working here

- Node 22, strict TypeScript, Vitest, zod.
- Keep the console thin: no business rules in UI code.
- Tests exercise real behavior with real objects and temp directories; mock only boundaries we do not own (CLIs, GitHub, clock).
- Write self-explanatory code; comment only a hidden constraint or a non-obvious why.
- Do not add a dependency, layer or abstraction without a concrete pain it solves.
- `policy.yaml` is the director's own file, untracked; `policy.example.yaml` is the tracked template. Only the director edits it. Memory never changes policy.
