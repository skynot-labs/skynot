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

[docs/getting-started.md](docs/getting-started.md) walks one order through the console.

## Run it for real

This spends your `claude` or `codex` subscription quota and writes to a repository of yours.

1. Log in to `claude` (and `codex` if a role uses it) and to `gh`, or register a [GitHub App](docs/github-app.md)
   so the shop opens its pull requests under its own name.
2. Copy `policy.example.yaml` to `policy.yaml`, `team.example.yaml` to `team.yaml` and `projects.example` to
   `projects`, and set your repository in the project's `project.yaml`. All three are yours and untracked.
3. `npm run check` verifies the logins and the GitHub access without spending quota or writing anything.
4. `npm run build:console`, then `npm run start`.

The steps in full are in [docs/getting-started.md](docs/getting-started.md), and what each file and variable
decides in [docs/configuration.md](docs/configuration.md). To keep a shop running on a machine you reach over SSH,
see [docs/running-on-a-server.md](docs/running-on-a-server.md).

The console binds to `127.0.0.1` and has no login. Do not expose it. To work with broad permissions
without risking your machine, use the [devcontainer](.devcontainer/README.md).

## Development

```bash
npm test               # includes the architecture rules
npm run typecheck
npm run test:e2e       # builds the console and walks it in a browser against a simulated shop
npm run dev:console    # the console with hot reload on :5173, against the shop on :4747
```

The console is the studio: its look comes from `console/src/design/tokens.json`, shown at `/design`. How to add a
place, a season or a wardrobe look is in [docs/studio-themes.md](docs/studio-themes.md). The public pages served at
`/github/` and how to publish them are in [docs/github-kit.md](docs/github-kit.md); the GitHub App in
[docs/github-app.md](docs/github-app.md).

Rules for working here are in [AGENTS.md](AGENTS.md), and how to send a change in
[CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
