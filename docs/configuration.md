# Configuration

A shop is configured by three files and a few environment variables. The files are yours and untracked. The service
reads them and writes to one only when you register or describe a project from the console. Each has a
commented example, which is the reference for its keys; this page says what each file decides and what to watch
for.

A mistake in any of them stops the service at startup, before anything runs.

## `policy.yaml`: what the shop may do

Copied from [policy.example.yaml](../policy.example.yaml). It holds the limits no agent can argue with: the
service checks every action against it, whatever the model proposed.

- **Spending.** `run_budget` caps one run in time and in dollars, and `max_usd_per_day` the whole day. At the
  daily cap the shop pauses itself; resuming that day is your call.
- **Writes to GitHub.** `limits` caps how many the shop makes for one order and in total per day, how many runs
  go in parallel, and how many times a worker may retry a change that fails your checks.
- **Names.** `branch_prefix` is where every work branch lives. `labels` are the labels the shop puts on its
  issues and the one it listens for.

The `repos` list is read only when there is no `projects/` folder. Prefer the folder.

## `projects/`: what the shop works on

One folder per project, copied from [projects.example](../projects.example/). The folder's name is the
project's id: lowercase letters, digits and dashes.

- **`project.yaml`** names the repository, its base branch, how to set the project up and how to check a change.
  `verify_commands` is what a worker's change must pass before a pull request is opened, so make it the same
  thing you would run yourself. `protected_paths` are files a worker may not touch without your signature.
- **`briefing.md`** is optional: private notes the Manager reads at every turn, for what must not go in the
  repository. Vision and architecture belong in the repository itself, where the workers read them.
- **`team.yaml`** is optional: a team for this project alone. Without it the shop's team serves it.

Several folders are several projects, each with its own conversation with the Manager, orders, team and
briefing. A repository belongs to one project. A project can also be registered from the console; it is
picked up at the next start.

## `team.yaml`: who does the work

Copied from [team.example.yaml](../team.example.yaml).

- **`roles`** sets the engine, and optionally the model, of the Manager and the developer. An optional
  `code_reviewer` reads each pull request before you do. It must differ from the developer in engine or model:
  whoever wrote the code does not approve it.
- **`workers`** are more developers to hand an order to, each with its own engine and model.
- **`advisors`** are read-only roles the Manager may consult before it proposes an order. Each has a `soul`: a
  markdown file such as the ones in [roles/](../roles/).
- **`library`** lists roles the Manager may propose to hire. Nothing changes until you sign the proposal.

## GitHub identity

Without further setup the shop acts as whoever `gh` is logged in as, so its pull requests are yours and you
cannot approve them. With a GitHub App it acts under the App's name, with tokens that last an hour.
[github-app.md](github-app.md) covers registering one and what the service does with it.

## Work that starts on GitHub

Label an issue with the intake label and the Manager of that project reads it and proposes an order, or asks
you what it needs to know. Nothing starts without your signature. A project that names a `board` in its
`project.yaml` gets its cards moved as its orders advance.

Moving a card needs one identity that can write the board and read the issue. Tried with personal tokens: a
fine-grained one reads the issue and cannot reach a board owned by a user, and a classic one needs both `project`
and `repo`. A board owned by an organization was not tried with a token. A failed move never stops the work.

## Known limits

- **`codex` reports no cost.** Its runs show $0 and never count toward `max_usd_per_day`, so a team whose
  developer runs on `codex` is not protected by the cap. A `claude` run that is stopped or times out records no
  cost either.
- **An order left blocked or on the bench holds every later order that shares files with it,** until you use Start
  now or discard it.
- **"Ready to merge" can lag one poll (30 s) after a push,** and may say there is no CI for a moment before it says
  pending.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `SKYNOT_POLICY` | `policy.yaml` | path to the policy |
| `SKYNOT_TEAM` | `team.yaml` | path to the shop's team |
| `SKYNOT_PROJECTS` | `projects` | folder with one folder per project |
| `SKYNOT_DATA` | `data/shop` | event log and the clones of your repositories |
| `PORT` | `4747` | console port |
| `SKYNOT_GITHUB_APP_ID` | none | id of a GitHub App the shop acts as |
| `SKYNOT_GITHUB_APP_KEY` | none | path to that App's private key, outside the repository |
| `SKYNOT_OFFICE_URL` | none | the HTTPS address the office is reached at; with it every request needs a session |
| `SKYNOT_STUDIO` | the public studio | address of the studio whose pages may call the office from a browser |

The `npm run` scripts that start or check the office (`dev`, `start`, `start:shared`, `dev:shared`, `check`, `stats`,
`setup`) also read a `.env` file at the root of the repository, when there is one: one `NAME=value` per line. It is
untracked, and a variable already set in the environment wins over the file. `npm run setup` writes the two App
variables there and leaves every other line as it is.

Set both App variables or neither: with only one the service refuses to start. The last two are explained in
[connecting a studio](connecting-a-studio.md); without them the office answers on its own machine only.

## What the shop keeps

Everything the shop knows is under `SKYNOT_DATA`: an append-only event log, and a clone of each managed
repository where the workers work. The console only shows what that log says. Back the folder up; deleting it
erases every order and conversation, though nothing on GitHub.

An office with an address also keeps `pairing.secret` and `session.key` there. They are passwords: leave them
out of a backup you share.
