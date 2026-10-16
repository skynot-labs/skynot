# 0005 · The shop merges a low-risk order on its own, under a rule

**Status:** accepted.

**Context.** Every order ends with the director merging it. A product built from a spec is tens of orders,
and the first run of one (Listo) showed the director's merge as the step everything waits on. The vision
left this out with a trigger, *the director merging low-risk orders without reading them*, and a shape:
low risk, approved by the reviewer, checks green, verified on the current base; never money, auth, a schema
or a large diff. The same run showed what "verified" can mean on a project started from nothing: its verify
command was `true`.

**Decision.** A project opts in with `auto_merge` in its `project.yaml`. The decision is code, not an agent:
a function in Governance takes the facts of an order and answers *merge* or the reason to hold it, and the
office evaluates it each time a review of the order is approved. It merges only when all of these hold: the
reviewer approved this round, having read the repository and not only the diff; the order's risk is `low`;
the project's verify commands check something (not only `true` or `:`); the branch was built on the current
tip of the base and does not conflict; the diff changes at most `max_changed_lines` lines (300 unless set);
and no changed path is protected, listed under `never`, or looks like authentication, payments, a migration
or a schema. A held order is recorded with its reason and waits for the director as before; a merged one is
announced in the chat.

**Alternatives.**
- *A merging role, an agent that judges whether to merge.* The judgment is already the reviewer's; a second
  model weighing the first would add cost and a step that cannot be audited by reading code.
- *Merge every approved order.* Approval says the code is right, not that the director need not see it;
  money, auth and schemas stay the director's even when the code is right.
- *A shop-wide switch in `policy.yaml`.* The rule depends on each project's verify commands and paths, and
  the director may trust one project and not another.

**Consequences.**
- Only projects kept on this machine (ADR 0003) can opt in: on GitHub the merge goes through the director's
  own branch protection, and that path is not built until a GitHub project asks for it.
- The rule leans on the Manager's risk and on path names; it holds when in doubt, so its mistakes cost the
  director a click, not a merge. A merge it should not have made is undone by hand; there is no revert yet.
- Turning it on does not change what is signed: the director still signs every order and its dependencies.
