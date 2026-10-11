# Security

Report a vulnerability through GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**. Do not open a public issue for it.

Skynot runs agents with your own `claude`, `codex` and GitHub credentials. By default the office answers on
`127.0.0.1` with no login; given an address, it asks every request for a session obtained with a pairing secret.
Anything that lets a role act outside `policy.yaml`, reach a credential, be driven from another origin, or get
or keep a session it should not have is in scope.

Fixes land on `main`; there are no maintained release branches yet.
