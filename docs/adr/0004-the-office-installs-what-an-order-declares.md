# 0004 · The office installs the dependencies an order declares

**Status:** accepted.

**Context.** A worker may run only the project's verify commands and two read-only git commands, and the
setup command runs once, before it works. An order that needs a library edits `package.json`, the library is
never installed, verification fails and the order dies after its rounds. A product started from nothing needs
a library on its first order, and most features of a real product need one sooner or later. A dependency is
also code from strangers that runs on the office's machine, which makes it the director's risk to take.

**Decision.** A work order lists the npm packages it adds, by name only, each marked as used at run time or
only to build and test. The Manager writes the list, the card shows it, and the director signs it with the
order. Before the worker starts, the office installs them in the worker's copy with `npm install`, so the
manifest, the lock file and the installed modules are what the worker builds on; the worker still cannot run
an install command itself. After the worker and again after verification, a change whose manifest names a
package that was not there before the worker started is refused, as a change to a protected path is. A name
must match npm's rule for package names, so nothing else reaches the command that installs it.

**Alternatives.**
- *Let the worker run the install command.* A model would choose what runs on the office's machine, and a
  command pattern broad enough to install anything is broad enough to install anything else.
- *Run the setup command again when the manifest changed.* It installs what the lock file says, which the
  worker cannot update without installing, and it would accept any package the worker wrote in.
- *A list of allowed packages in `policy.yaml`.* A list written ahead of time is either too short to build
  with or too long to mean anything; the signature on each order is where the director already decides.

**Consequences.**
- Installing runs the packages' install scripts, as `npm ci` in the setup command already does. Signing a
  package is trusting it; nothing audits it yet.
- Only npm. Another package manager would need its own command and a project setting saying which one.
- A package the worker discovers it needs is a new order, or a follow-up that the director signs with the
  package in it.
