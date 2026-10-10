# Security

Report a vulnerability through GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**. Do not open a public issue for it.

Skynot runs agents with your own `claude`, `codex` and GitHub credentials, and its console binds to
`127.0.0.1` with no login. Anything that lets a role act outside `policy.yaml`, reach a credential, or
be driven from another origin is in scope.

Fixes land on `main`; there are no maintained release branches yet.
