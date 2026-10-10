# skynot

A dev shop of AI agents. You talk to one agent, the Manager, in a web console. The Manager turns ideas
into work orders, you sign them, a worker implements each one in a git worktree, the service verifies
the change and opens a pull request, and you review and merge on GitHub.

Start with [docs/vision.md](docs/vision.md), then the current plan in [docs/plans/](docs/plans/).

## Try it without cost

Simulated engines and a fake GitHub; nothing leaves your machine.

```bash
npm install
npm run build:console
npm run dev            # http://127.0.0.1:4747
```

## Run it for real

This spends your `claude` subscription quota and writes to the repository named in `policy.yaml`.

1. Log in to `claude` (and `codex` if you use it) and to `gh`.
2. `cp policy.example.yaml policy.yaml` and set your repository. `policy.yaml` is yours and untracked;
   only you edit it.
3. `cp team.example.yaml team.yaml` and choose the engine, and optionally the model, of each role. Also
   untracked and yours. A typo stops the service at startup, before anything runs.
4. `npm run build:console`, then `npm run start`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SKYNOT_POLICY` | `policy.yaml` | path to the policy |
| `SKYNOT_TEAM` | `team.yaml` | path to the team |
| `SKYNOT_DATA` | `data/shop` | event log and workspaces |
| `PORT` | `4747` | console port |

The console binds to `127.0.0.1` and has no login. Do not expose it. To work with broad permissions
without risking your machine, use the [devcontainer](.devcontainer/README.md).

## Development

```bash
npm test               # includes the architecture rules
npm run typecheck
```

Rules for working here are in [AGENTS.md](AGENTS.md).
