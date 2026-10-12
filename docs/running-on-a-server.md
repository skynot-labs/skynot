# Running the shop on a server

How to keep a shop running on a machine you reach over SSH, so it works while your laptop is closed. Everything
runs on that one machine: the service, the `claude` and `codex` engines, and the clones of your repositories.

**Status:** written from the code and from each tool's own help, not yet run end to end on a fresh server.
Expect to fix small things on the first run, and please report them.

Do [getting started](getting-started.md) on your own machine first. This page only covers what changes on a
server.

## What you are setting up

- **No public address, unless you give it one.** As set up here the office has no login and answers only as
  `127.0.0.1` or `localhost` on its own port, so you reach it through an SSH tunnel and a domain in front of it
  gets a 403, on purpose. To reach it without the tunnel, give it an address and pair a studio with it:
  [connecting a studio](connecting-a-studio.md).
- **Your logins live on the server.** Whoever can run commands as the shop's user can use your `claude` and
  `codex` subscriptions and your GitHub token. That user should exist for the shop and nothing else.
- **Your subscription's terms are yours to check.** The shop drives `claude` and `codex` unattended. Whether
  your plan allows that from a server is between you and the provider.

## 1. A user for the shop

Create a user without `sudo`, and do everything below as that user. A worker runs your project's setup and
test commands on code it just wrote; as an unprivileged user the worst case is that user's home.

## 2. Install

The server needs Node 22 or later, git and the GitHub CLI (`gh`). If a `codex` role writes code, install
`bubblewrap` too: `codex` runs commands inside a sandbox built on it.

```bash
git clone https://github.com/skynot-labs/skynot.git
cd skynot
npm ci
npm run build:console
npm install --global @anthropic-ai/claude-code @openai/codex
```

The last command needs a global npm folder the user can write to. Whichever way you install them, `claude` and
`codex` must be on the `PATH` of the service in step 6.

## 3. Log in without a browser

Each tool can log in from a terminal on a machine with no browser:

```bash
claude auth login            # prints an address to open on your own machine
codex login --device-auth    # prints a code to enter on your own machine; only if a role uses codex
gh auth login --with-token < token.txt && rm token.txt
```

Then confirm all three: `claude auth status`, `codex login status`, `gh auth status`.

Give the GitHub token only the repositories the shop manages, and an expiry. To have the shop open its pull
requests under its own name, use a [GitHub App](github-app.md) instead: put its private key in a file only the
shop's user can read (`chmod 600`), outside the repository.

## 4. Configure

Write `policy.yaml`, `team.yaml` and `projects/` as in [getting started](getting-started.md); what each one
decides is in [configuration.md](configuration.md). On a server that works unattended the daily cap in
`policy.yaml` is the limit that matters most: set it to what you are willing to lose in a day.

## 5. Check before you start

```bash
npm run check
```

It verifies the three logins, the `codex` sandbox and what the GitHub identity can read and push, without
spending quota or writing anything. Fix every `FAIL` before going on.

## 6. Keep it running

A systemd user service restarts the shop when it stops and starts it at boot. Save this as
`~/.config/systemd/user/skynot.service`, with the paths of your server:

```ini
[Unit]
Description=skynot shop
After=network-online.target

[Service]
WorkingDirectory=%h/skynot
ExecStart=/usr/bin/npm run start
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
# Only with a GitHub App:
# Environment=SKYNOT_GITHUB_APP_ID=123456
# Environment=SKYNOT_GITHUB_APP_KEY=%h/.config/skynot/app.pem
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

`PATH` must include the folders that `which node`, `which claude`, `which codex` and `which gh` print: a
service does not read your shell's profile.

```bash
systemctl --user daemon-reload
systemctl --user enable --now skynot
journalctl --user -u skynot -f
```

The log should end with the console's address. For the service to run while you are logged out, an
administrator enables lingering once: `sudo loginctl enable-linger <user>`.

## 7. Open the console

From your own machine, forward the port, keeping the same number on both sides:

```bash
ssh -L 4747:127.0.0.1:4747 <user>@<server>
```

Then open http://127.0.0.1:4747. The console works only while that SSH session is open; the shop keeps
working either way.

With an address instead of the tunnel, add `Environment=SKYNOT_OFFICE_URL=https://…` to the service and take
the pairing link from its log. The steps are in [connecting a studio](connecting-a-studio.md).

## Living with it

- **Updating.** `git pull`, `npm ci`, `npm run build:console`, then `systemctl --user restart skynot`. Rebuild
  the console every time: an old console against a new service says the two are different versions.
- **Restarting mid-work.** An order that was being worked when the service stopped comes back blocked, saying
  the shop restarted. Retry it from its detail.
- **Backing up.** Everything the shop knows is in `data/shop`: its event log and the clones. Copy that folder;
  the three configuration files and the App's key are the rest of what you would need to rebuild the server.
- **One shop per data folder.** A second service on the same `data/shop` refuses to start.
- **Stopping the spending.** Pause the shop from the studio, or `systemctl --user stop skynot`.

## What this is not

There are no accounts: whoever holds the pairing link is the director. And there is no way to run the engines
on a different machine than the service. Those are planned, not built.
