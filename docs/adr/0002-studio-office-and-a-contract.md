# 0002 · A studio, an office and a contract between them

**Status:** accepted and built (#31, #37, #38, #39).

**Context.** Skynot was one program: a service that also served its console, and a console that took the
shape of the state from the service's source. Trying it meant cloning and building everything, and neither
half could be replaced or released without the other. The director wants a newcomer to open a public page
and connect it to an office of their own, wants either side to be replaceable, and wants to meet the
problems a real product meets: releases, and a contract that cannot break silently.

**Decision.** Three packages in one repository, as npm workspaces. `packages/office` is the service.
`packages/studio` is the console in the browser, published on GitHub Pages and also served by each office.
`packages/contract` is what they exchange, as zod schemas: the state, each command's payload, the formats
that cross the wire, the stream events, and a version the office reports at `/api/meta`. The office
validates and types what it answers with the contract; the studio parses what it receives with it and
refuses an office that reports another version. `test/architecture` fails when the studio imports anything
but itself and the contract, when the contract imports anything but zod, or when the office imports the
studio. A studio elsewhere reaches an office over HTTPS behind a session
([connecting a studio](../connecting-a-studio.md)).

**Alternatives.**
- *Keep serving the console from the office only, same origin.* Simpler, and no session or cross-origin
  rules to get right. Rejected: it keeps the entry cost and leaves nothing to replace.
- *Separate repositories.* Deferred until the contract has changed once and shown what a release costs.
- *Another workspace tool.* npm workspaces needed no new dependency; nothing here asks for more.

**Consequences.**
- A change to what the two sides exchange starts in the contract, and breaking a studio built earlier means
  raising `CONTRACT`. Nothing forces that bump yet: both sides import the same constant.
- The studio stops at a state the contract does not describe, naming the field, instead of failing inside
  a view. A schema stricter than what an office really sends would lock a studio out, so the office's tests
  parse the state of a real shop at every moment of an order's life.
- Every script still runs from the repository root, and a shop's policy, team, projects and data stay
  there.
- The paths other than the commands', the status codes and how a session travels are not in the contract.
