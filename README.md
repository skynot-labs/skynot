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
2. `cp policy.example.yaml policy.yaml` for the limits and the daily cap, and `cp -r projects.example projects`,
   then rename `projects/example` to the project's name and set its repository. `projects/` and `policy.yaml` are
   yours and untracked; only you edit them. A project folder holds `project.yaml`, an optional `team.yaml` (without
   one, the shop's `team.yaml` serves it) and an optional `briefing.md`: private notes the Manager reads at every
   turn, for what must not go in the repository. Vision and architecture belong in the repository itself. Without a `projects/` folder,
   the `repos` list in `policy.yaml` serves as the only project; with one, that list is ignored. Several folders
   are several projects, each with its own conversation with the Manager, team, orders and briefing; the console
   gets a selector. A repository belongs to one project.
3. `cp team.example.yaml team.yaml` and choose the engine, and optionally the model, of each role. Also
   untracked and yours. A typo stops the service at startup, before anything runs. The optional
   `advisors` section lets the Manager consult read-only roles (see `roles/`) before it proposes an order,
   and `library` lists roles it may propose to hire; you sign the change in the console. An optional
   `code_reviewer` role (another engine or model than the developer) reviews each pull request before you
   do. The pull request's CI status is read from GitHub Actions, so the token needs Actions: read.
4. `npm run check` verifies what the shop needs without spending quota or writing anything: the CLI logins,
   the `codex` sandbox, and what the GitHub token can read and push. Each problem comes with how to fix it.
   The console shows the same list at the top and the server prints it at startup.
5. `npm run build:console`, then `npm run start`.

Work can also come from GitHub: label an issue `taller:ready` (see `labels.intake` in `policy.example.yaml`) and
the Manager of that project turns it into a proposed order, or asks you what it needs to know. A project that
names a `board` in its `project.yaml` gets its cards moved as the orders advance. Everything that waits for an
answer, from the Manager or from a worker that stopped to ask, is listed under "Waiting for you".

| Variable | Default | Meaning |
| --- | --- | --- |
| `SKYNOT_POLICY` | `policy.yaml` | path to the policy |
| `SKYNOT_TEAM` | `team.yaml` | path to the shop's team |
| `SKYNOT_PROJECTS` | `projects` | folder with one folder per project |
| `SKYNOT_DATA` | `data/shop` | event log and workspaces |
| `PORT` | `4747` | console port |
| `SKYNOT_GITHUB_APP_ID` | none | id of a GitHub App the shop acts as |
| `SKYNOT_GITHUB_APP_KEY` | none | path to that App's private key, outside the repository |
| `SKYNOT_GITHUB_APP_INSTALLATION` | the only one | installation to use when the App is installed in several accounts |

Without the App variables the shop uses whoever `gh` is logged in as. With them it opens issues, pushes and opens
pull requests as the App, with tokens that last an hour, so you can review and approve what it opens. The App needs
Contents, Issues and Pull requests (read and write), Actions (read) and, for a board, organization Projects (read
and write), and must be installed on every project's repository.

The console binds to `127.0.0.1` and has no login. Do not expose it. To work with broad permissions
without risking your machine, use the [devcontainer](.devcontainer/README.md).

## Development

```bash
npm test               # includes the architecture rules
npm run typecheck
```

Rules for working here are in [AGENTS.md](AGENTS.md).
