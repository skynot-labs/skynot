# skynot

A dev shop of AI agents. You talk to one agent, the Manager, in a web console. The Manager turns ideas
into work orders, you sign them, a worker implements each one in a git worktree, the service verifies
the change and opens a pull request, and you review and merge on GitHub.

Start with [docs/vision.md](docs/vision.md); decisions are in [docs/adr/](docs/adr/) and what is left to do in the
[issues](https://github.com/skynot-labs/skynot/issues). The project's
page is [skynot-labs.github.io/skynot](https://skynot-labs.github.io/skynot/), and the shop can act on GitHub as
the [skynot-shop](https://github.com/apps/skynot-shop) App.

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

1. Log in to `claude` (and `codex` if a role uses it).
2. `npm run setup` shows the GitHub App it will create and waits for you, creates it once you confirm on GitHub,
   keeps its key outside the repository, copies `policy.yaml`, `team.yaml` and `projects/` from their examples
   without touching one that exists, and runs the check. It has not yet been run against GitHub itself; the
   by-hand path is in the guide.
3. `npm run check` verifies the logins and the GitHub access again, without spending quota or writing anything.
4. `npm run build:console`, then `npm run start`.
5. `npm run stats` prints, from the event log, how long each order spent in each stage and what it cost.

The steps in full are in [docs/getting-started.md](docs/getting-started.md), and what each file and variable
decides in [docs/configuration.md](docs/configuration.md). To keep a shop running on a machine you reach over SSH,
see [docs/running-on-a-server.md](docs/running-on-a-server.md).

As started here the office answers on `127.0.0.1` only and has no login: do not expose it. To use the public
studio or another device, give it an address and a session as in
[docs/connecting-a-studio.md](docs/connecting-a-studio.md). To work with broad permissions
without risking your machine, use the [devcontainer](.devcontainer/README.md).

## Development

```bash
npm test               # includes the architecture rules
npm run typecheck
npm run test:e2e       # builds the console and walks it in a browser against a simulated shop
npm run dev:console    # the console with hot reload on :5173, against the shop on :4747
```

The code is three packages under `packages/`: `office` is the service, `studio` the console in the browser, and
`contract` what the two exchange ([why](docs/adr/0002-studio-office-and-a-contract.md)). Every command runs from
the repository root.

The console is the studio: its look comes from `packages/studio/src/design/tokens.json`, shown at `/design`. How
to add a place, a season or a wardrobe look is in [docs/studio-themes.md](docs/studio-themes.md). The public pages
served at `/github/` and how to publish them are in [docs/github-kit.md](docs/github-kit.md); the GitHub App in
[docs/github-app.md](docs/github-app.md).

Rules for working here are in [AGENTS.md](AGENTS.md), and how to send a change in
[CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
