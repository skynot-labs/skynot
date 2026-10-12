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

### Log in to the tools

The shop drives the same command-line tools you would, with your logins:

```bash
npm install --global @anthropic-ai/claude-code @openai/codex
claude            # log in once; codex only if a role uses it: codex login
gh auth login     # or a GitHub App, see below
```

A GitHub token needs read and write on the repository's contents, issues and pull requests, and read on
Actions. Scope it to the repositories the shop manages and give it an expiry: every process on the machine can
read it. To have the shop act under its own name, so you can review and approve what it opens, register a
[GitHub App](github-app.md) instead.

### Write the three files

```bash
cp policy.example.yaml policy.yaml
cp team.example.yaml team.yaml
cp -r projects.example projects
mv projects/example projects/my-project
```

Then set `repo` in `projects/my-project/project.yaml` to your repository, and its `setup_command` and
`verify_commands` to how your project installs and checks itself. The three files are yours and untracked.
[configuration.md](configuration.md) says what each one decides.

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

## When something does not work

- **The studio says it and the office are different versions.** One of them is older, and the screen says
  which. With the console the office serves itself, the office was started before the console was rebuilt: run
  `npm run build:console` and restart it. With the public studio, update the office: `git pull`, `npm ci`, and
  start it again.
- **The service refuses to start.** A typo in `policy.yaml`, `team.yaml` or a `project.yaml` stops it before
  anything runs, and the message says what is wrong.
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
