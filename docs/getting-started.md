# Getting started

Two steps, in order. The first costs nothing and needs no account. The second spends your own `claude` or
`codex` quota and writes to a repository of yours, so do it once the first one makes sense.

You need Node 22 or later and git.

## 1. See it work, simulated

```bash
git clone https://github.com/skynot-labs/skynot.git
cd skynot
npm install
npm run build:console
npm run dev
```

Open http://127.0.0.1:4747. The engines and GitHub are simulated: nothing leaves your machine and nothing is
spent. Walk one order through, because the real shop works the same way:

1. **Tell the Manager what you want.** Open the chat with the Manager and write an idea, such as "Add a CSV
   export to the invoices page".
2. **Answer its question.** The Manager asks before it writes anything up. Answer in the chat or under
   **Decisions**.
3. **Sign the work order.** The Manager files an order with an objective, acceptance criteria and what is out
   of scope. Nothing starts until you sign it. You can discard it instead.
4. **Watch it be worked.** A developer takes the order to the bench. In the studio you see who is working; under
   **Work orders**, where each order stands.
5. **Review and merge.** The order reaches review with a pull request. In the simulated shop the order's detail
   has a **Merge (simulated)** button; in the real one you merge on GitHub, and the order is delivered when the
   shop sees the merge.

That is the whole loop: you decide what gets built and what gets merged, and the team does the rest. **Costs**
shows what each run spent, and **Activity** is the log of everything that happened.

The simulated shop keeps its state in `data/mock`. Delete that folder to start over.

## 2. Run it on a repository of yours

Pick a repository where a wrong pull request is cheap, and read this first:

- **It spends your subscription.** Every turn of the Manager and every run of a worker uses your `claude` or
  `codex` quota. `policy.yaml` caps the spending per run and per day, and the shop pauses itself at the daily
  cap.
- **It writes to your repository.** It opens issues, pushes branches under a prefix and opens pull requests. It
  never merges: that stays with you.
- **Workers run commands on this machine.** A worker runs your project's setup and test commands on code it
  just wrote. To keep that away from your own files, run the shop in the
  [devcontainer](../.devcontainer/README.md).

### Log in to the engines

The shop drives the same command-line tools you would, with your logins:

```bash
npm install --global @anthropic-ai/claude-code @openai/codex
claude            # log in once; codex only if a role uses it: codex login
```

### Set the shop up

```bash
npm run setup
```

It asks for the repository and who will own the GitHub App, then does five things, skipping each one that is
already done, so it is safe to run again:

1. **Says what it will create and waits for Enter:** a private GitHub App with write on the repository's
   contents, issues and pull requests, read on Actions and metadata, and no webhook.
2. **Creates the App.** It prints an address on `127.0.0.1` and tries to open it; that page sends the App's
   description to GitHub, where you confirm. GitHub then sends the browser back to that address with the App's
   key. The browser must reach the machine the command runs on: over SSH or in a container, forward the port
   it prints first.
3. **Keeps the key outside the repository,** in `~/.config/skynot/app.pem`, readable only by you, and writes
   the App's id and that path to `.env`, which every `npm run` script that starts or checks the office reads.
4. **Copies `policy.yaml`, `team.yaml` and `projects/` from their examples** when they do not exist, with your
   repository in the new project's `project.yaml`. It never overwrites or edits one that is already there.
5. **Sends you to install the App on the repository,** which only you can do, and then runs the check below.

If it stops after the App exists, it says which App was left on GitHub and how to delete it.

> Creating the App through this command has not yet been run against GitHub itself. The flow it follows was
> done by hand on 2026-10-11, and the command is tested against a stand-in for GitHub. If it fails you, the
> by-hand path below still works; please open an issue.

Then set `setup_command` and `verify_commands` in `projects/<your-project>/project.yaml` to how your project
installs and checks itself. The three files are yours and untracked. [configuration.md](configuration.md) says
what each one decides.

**By hand instead.** Copy `policy.example.yaml` to `policy.yaml`, `team.example.yaml` to `team.yaml` and
`projects.example` to `projects`, rename `projects/example` and set `repo` in its `project.yaml`. For GitHub,
either register the App yourself as in [github-app.md](github-app.md), or run `gh auth login` and let the shop
act as you: that token needs read and write on the repository's contents, issues and pull requests, and read on
Actions. Scope it to the repositories the shop manages and give it an expiry, because every process on the
machine can read it.

### Check before you spend

```bash
npm run check
```

It verifies the logins, the `codex` sandbox and what the GitHub identity can read and push in each project's
repository, without spending quota or writing anything. Each problem comes with how to fix it. The console
shows the same list at the top.

### Start

```bash
npm run build:console
npm run start
```

Open http://127.0.0.1:4747 and give the Manager something small for the first order. The shop keeps its event
log and its clones of your repositories under `data/shop`: that folder is the shop's memory, so back it up
rather than delete it.

### See how the shop is doing

```bash
npm run stats
```

It reads the event log and prints how long each order spent waiting for your signature, being built, in review
and waiting for your merge, with the rounds of review, the blocks and the cost, and the same per worker and
model. It writes nothing and is safe to run beside a live office. The numbers describe what happened; with a
few orders, and workers that did not get the same ones, they do not say which model is better.

## When something does not work

- **The studio says it and the office are different versions.** One of them is older, and the screen says
  which. With the console the office serves itself, the office was started before the console was rebuilt: run
  `npm run build:console` and restart it. With the public studio, update the office: `git pull`, `npm ci`, and
  start it again.
- **The service refuses to start.** A typo in `policy.yaml`, `team.yaml` or a `project.yaml` stops it before
  anything runs, and the message says what is wrong.
- **A button seems to do nothing.** A command the office refuses, or never gets, is said in a notice at the top
  of the page, or of the dialog that is open; it stays until you dismiss it or the next command goes through.
- **An order is blocked.** Its detail says why and offers what can be done: retry, approve a protected path,
  send a follow-up or discard it.
- **The shop paused itself.** It reached the daily cost cap. Resuming the same day is your call, from the
  studio.

## Where it runs today

One machine runs everything: the service, the engines and the clones. As started above, the office answers
only on that machine, as `127.0.0.1` or `localhost` on its own port, and asks for no login.

To use it from elsewhere there are two ways:

- **Give the office an address and pair a studio with it.** The office then asks every request for a session,
  and you can use the public studio or your phone. With Tailscale it is one command, `npm run start:shared`;
  [connecting-a-studio.md](connecting-a-studio.md) has the steps.
- **Forward the port over SSH**, keeping the same number on both sides, and open http://127.0.0.1:4747 on your
  own machine:
  ```bash
  ssh -L 4747:127.0.0.1:4747 you@the-machine
  ```

Do not put an office that asks for no session behind a public address or a reverse proxy.
[running-on-a-server.md](running-on-a-server.md) covers keeping a shop running on a server: logging the tools in
without a browser, and a service that restarts it.
