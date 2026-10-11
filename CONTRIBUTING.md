# Contributing

Skynot is maintained by one person, in the open. Fixes and focused improvements are welcome. For anything
larger than a small fix, open an issue first and say what pain it solves: a pull request that adds a
feature nobody asked for is likely to be declined, however good the code.

To report a vulnerability, do not open an issue: see [SECURITY.md](SECURITY.md).

## Set up

You need Node 22 or later. Nothing else: the simulated shop needs no account and spends nothing.

```bash
npm ci
npm run build:console
npm run dev            # http://127.0.0.1:4747, simulated engines and a fake GitHub
```

[docs/getting-started.md](docs/getting-started.md) explains what you are looking at.

## Before you open a pull request

```bash
npm run typecheck
npm test               # includes the architecture rules
npm run test:e2e       # walks the console in a browser against the simulated shop
```

The browser suite needs Chromium once: `npx playwright install --with-deps chromium`. CI runs the same three
commands.

## What a change should look like

The rules for the code are in [AGENTS.md](AGENTS.md), and they apply to people as much as to agents. The ones
that most often decide a review:

- **The domain imports no adapter and no other context's internals.** A test enforces it.
- **Tests exercise real behavior.** Real objects and temp directories; a mock only at a boundary the project
  does not own, such as a CLI, GitHub or the clock. A test that could not fail for a real reason does not
  belong.
- **No new dependency, layer or abstraction without a concrete pain it solves.** Say the pain in the pull
  request.
- **The console holds no business rules.** If a view needs one, it belongs in the service, or in a function
  with its own test.
- **A doc changes in the pull request that makes it wrong.** Docs say why and what to watch for; they do not
  repeat a value the code already holds.

Everything in the repository is in English: code, comments, commits, issues and pull requests.

## Commits and pull requests

- **One concern per pull request.** Two unrelated fixes are two pull requests.
- **Each commit stands alone.** Pull requests are merged by rebase, so every commit lands on `main` as you
  wrote it. Squash "fix review comments" into the commit it fixes.
- **Subjects** start with `feat:`, `fix:`, `test:`, `docs:`, `ci:` or `chore:` and say what changes for the
  person using the shop. The body says why.
- **Rebase onto `main`** when it moves; do not merge `main` into your branch.
- **Link the issue** with `Closes #N` in the pull request body when there is one.
- **Say what you checked and what you did not.** A pull request that names its untested part is easier to
  trust than one that claims everything works.

## License

By contributing you agree that your work is released under the [MIT license](LICENSE).
