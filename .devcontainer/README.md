# Devcontainer

A throwaway workspace where an agent can work with broad permissions: the worst case is a broken
container, not the host.

**Status:** written and syntax-checked (`docker compose config`, `sh -n`, `bash -n`). The image has not
been built or opened yet, so expect to fix small things on the first run.

## Host requirements

- **Docker** with Compose **2.24 or later** (the optional `env_file` entries need it).
- **VS Code** with the **Dev Containers** extension.
- **A fine-grained GitHub token** with only this repository and the repositories the shop manages
  selected, an expiry, and read and write on contents, issues and pull requests. Nothing else.
- Only for GitHub Projects: a separate classic token with `project` and nothing wider. Fine-grained
  tokens cannot reach a Project owned by a user account.

## First open

1. Open the folder in VS Code and run **Dev Containers: Reopen in Container**. `post-create.sh` installs
   dependencies, the `claude` and `codex` CLIs, and builds the console.
2. Log in to GitHub from the host, with the scoped token in `$TOKEN`:
   ```bash
   printf '%s\n' "$TOKEN" | docker exec -i -u vscode \
     "$(docker ps -q --filter label=devcontainer.local_folder="$PWD")" \
     gh auth login -h github.com --with-token
   ```
   The token goes through stdin, never an argument or an environment variable. Then, in a container
   terminal: `gh auth setup-git`.
3. In a container terminal, log in to the agents: `claude` and `codex login`. Both logins live in
   named volumes and survive a rebuild.
4. Check: `gh auth status`, `claude auth status`, `codex login status`, then `npm test`.
5. Run the shop: `npm run dev` for simulated engines, or `npm run start` with a `policy.yaml`.
   Port 4747 is forwarded with `requireLocalPort`, because the API only accepts the `Host` it was
   started on.

## What lives where

| Thing | Where | Survives a rebuild? |
|---|---|---|
| Source | Host folder, mounted | Yes |
| `node_modules` | Named volume | Yes |
| `data/` (event log, clones of managed repos) | Named volume `shop-data` | Yes |
| `~/.claude`, `~/.codex` logins | Named volumes | Yes |
| `gh` login | Container's `~/.config/gh` | **No**, log in again |
| Tailscale login | Named volume `tailscale-state` | Yes |
| `policy.yaml` | Host folder, untracked | Yes |

Because `data/` is a volume, the clones the shop makes of managed repositories, and the `npm ci`,
`typecheck` and `test` it runs on code a worker just wrote, all happen inside the container.

## Reaching the office from your other devices

Tailscale is installed and its daemon starts with the container, idle until you join your tailnet. It gives
the office an HTTPS address only your own devices can reach, which is what a studio elsewhere needs
([connecting a studio](../docs/connecting-a-studio.md)).

1. Join once. It prints a link to sign in; the login then survives a rebuild:
   ```bash
   sudo tailscale up --operator=vscode --hostname=skynot-dev
   ```
2. Start the office shared, and open the pairing link it prints from a device of the tailnet:
   ```bash
   npm run dev:shared       # simulated engines; npm run start:shared for the real shop
   ```
   The first time, it stops with a link from Tailscale to enable Serve and HTTPS for your tailnet. Accept it and
   start again.

The container has no network interface for Tailscale, so programs inside it cannot open connections into your
tailnet. Sharing goes the other way only.

## Security model

- The devcontainer's files carry no credential. `.host.env` holds only the `GITHUB_*` values derived
  from `origin`.
- **The token you log `gh` in with is the whole GitHub exposure.** `gh` stores it in plain text in
  `~/.config/gh/hosts.yml`, and every process in the container can read it, including extensions,
  agents and package install scripts. Scoped to a few repositories with an expiry, a leak reaches
  those repositories for a limited time.
- **The same holds for the agent logins** in the `claude-home` and `codex-home` volumes: whoever runs
  in the container can use your subscriptions. That is the price of letting an agent work here.
- **In your tailnet the container is a machine like any other.** Any process in it can run `tailscale serve`,
  or `tailscale funnel`, which publishes a port to the internet. Keep Funnel off in your tailnet's policy
  unless you want it, and remove the machine from the admin console when you stop using it.
- **Never pass the token as `GH_TOKEN`** in `local.env` or Compose: it shows up in `docker inspect`.
- **Do not rely on hooks.** Nothing from the host's `~/.claude` is mounted, so personal hooks and
  global instructions do not apply here. The last gate against a bad push to `main` is branch
  protection on GitHub, with required pull requests. Set it on every managed repository.
- **SSH.** Dev Containers forwards your host SSH agent to processes it starts. If it holds a key, an
  agent in the container can push with it to every repository that key reaches, which defeats the
  scoped token. The post-create step rewrites `git@github.com:` to HTTPS so pushes use the token, but
  that does not stop the forwarding. Keep the host agent empty while working here (`ssh-add -D`), or
  verify with `ssh-add -l` inside the container.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `gh` asks you to log in | The container was rebuilt | Step 2 again |
| 403 or 404 on a repository | The token is scoped to specific repositories, by design, or it expired | Add the repository to the token, or issue a new one |
| `npm ci` fails with `EACCES` | A volume is root-owned and the `chown` did not run | `sudo chown -R vscode:vscode node_modules data ~/.claude ~/.codex`, then rerun `post-create.sh` |
| The console answers `unknown host` | Port 4747 was forwarded to another local port | Free port 4747 on the host and reopen |
| `claude` or `codex` not found | Global install failed in `post-create.sh` | `npm install --global @anthropic-ai/claude-code @openai/codex` |
