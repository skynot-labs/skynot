# 0001 · A devcontainer for autonomous work

**Status:** proposed. Written, not yet built or used.

**Context.** The shop runs `npm ci`, `typecheck` and `test` of the managed repository on code a worker
has just written, with `sh -c`, on the machine that runs skynot. On the director's laptop that code
reaches the home directory: agent logins, `gh`, SSH keys. The same fear limits how freely an
assistant can be given permissions while developing skynot itself.

**Decision.** Develop and run skynot inside a devcontainer based on the Knotty one. It holds no host
credentials: GitHub access is a fine-grained token scoped to a few repositories, agent CLIs log in
inside the container, and the shop's data lives in a named volume. Branch protection on GitHub is the
last gate against pushes to `main`, since local hooks do not follow into the container.

**Alternatives.**
- Run on the host and accept the exposure: fine for a toy pilot repo, wrong once workers run code
  nobody has read.
- A VPS or the KVM VM from the vision: the right home for deployment (phase 6), too heavy for
  day-to-day development.
- Docker only around the verify step: narrower, but leaves the agent CLIs on the host.

**Consequences.**
- The same image can become the worker image of phase 6.
- The forwarded SSH agent can undo the isolation; the README says how to avoid it.
- Agent logins inside the container are readable by anything running there.
- Slower file I/O on macOS, avoided for `node_modules` and `data` with named volumes.
