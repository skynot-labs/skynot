# Running the shop as a GitHub App

The shop reaches GitHub either as whoever `gh` is logged in as, or as a GitHub App. As an App it opens issues, pushes branches and opens pull requests under the App's name, so the director can review and approve what it opens. The variables that switch it on are in [configuration.md](configuration.md#environment-variables). `npm run setup` registers the App and writes those variables; this guide covers what it does, how to register the App by hand, and what the service does with it.

The App is only an identity. Installing it starts no agent: the Node service runs separately, and an order runs only after the director signs it.

## Register the App with the setup command

`npm run setup` creates the App from a manifest: you confirm once on GitHub, and the command receives the App's id and private key on a local address. It asks for write on contents, issues and pull requests and read on Actions and metadata, with no webhook, installable only on the owning account. The key goes to `~/.config/skynot/app.pem` (under `XDG_CONFIG_HOME` when that is set) and the two variables to `.env`. It never overwrites a key, and it does not request the Projects or Workflows permissions: add those in the App's settings if you need them, as described below. Installing the App on a repository stays a click of yours, which the command sends you to.

This path has not yet been run against GitHub itself from this code: the manifest flow was done by hand on 2026-10-11, and the command is tested against a stand-in for GitHub.

## Register the App by hand

Under the owning account's settings, open **Developer settings → GitHub Apps → New GitHub App**. For the `skynot-labs` organization, the name, description, homepage and badge are in [LISTING.md](../packages/studio/public/github-kit/app/LISTING.md), generated from `packages/studio/src/github/site.json`.

- **Webhook:** leave *Active* unchecked. The service polls GitHub for labeled issues and merged pull requests; it has no webhook receiver.
- **Callback URL, setup URL, user authorization:** leave empty. The service authenticates only as an installation, never on behalf of a user.
- **Permissions:** the table in LISTING.md. Projects is an organization permission, so it only covers a board owned by an organization; request it only if a project names a `board`.
- **Where it can be installed:** *Only on this account* unless repositories of another account are involved.

Pushing a change to a workflow file needs GitHub's separate **Workflows** permission. `.github/` is a protected path in `projects.example`, so a worker cannot touch it without the director's signature; add the permission only if you sign such orders.

## Install and configure

After the setup command only the first step is left.

1. Install the App on every account that owns a project's repository or its board. Prefer **Only select repositories**.
2. Generate a private key in the App's settings and keep the `.pem` outside the repository.
3. Set `SKYNOT_GITHUB_APP_ID` and `SKYNOT_GITHUB_APP_KEY` (the path to the key) for the service, in the environment or in `.env`. Set both or neither: with only one the service refuses to start.
4. Run `npm run check`. Its first line names the identity in use (`GitHub: acting as GitHub App <id>`), followed by what that identity can read and push in each project's repository.

There is no installation setting. The service lists the App's installations and uses the one of the account each `gh` or `git` command is about: the repository's owner, the board's owner, or the origin of the clone it runs in. A command about an account the App is not installed in fails with a message that names the accounts it is installed in. A board in another account than the repository gets a note with the issue's address instead of the issue itself, because no single installation sees both.

## What the service holds

The private key stays in the file you point to. From it the service signs a short-lived JWT and asks GitHub for an installation token per account. A token lasts an hour and is replaced a few minutes before it expires. `gh` receives it in its environment and `git` as an HTTP header for `github.com`, with the credential helper disabled, so no token is written to disk and no stored `gh` login is used.

The engines keep their own logins: the App does not authenticate `claude` or `codex`.

## What a review is

A `code_reviewer` role posts its verdict as a comment on the pull request, under the App's name. It is not a GitHub approval, and the service never merges: review and merge stay with the director.

## References

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Creating a custom badge](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/creating-a-custom-badge-for-your-github-app)
- [Installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)
