# @skynot/contract

What a studio and an office say to each other, and nothing else: the state the office reports, the commands it
accepts, the events it streams and the version of all three. To write another studio, or a client for the
terminal, this package is the whole specification.

It depends on nothing of the office or the studio. Both depend on it.

## Rules

- **The schema is the source.** Every shape is a zod schema named `SomethingSchema`; its type is inferred from it
  and exported as `Something`. No type is written by hand next to a schema.
- **An office may send more than the contract says.** Objects accept unknown keys, so adding a field never breaks
  a studio built earlier. The office's tests check the opposite direction: that it sends nothing the contract
  does not name.
- **Identifiers are plain strings here.** The office's own branded types stay inside the office.
- **The contract owns the formats that cross the wire**, such as the shape of a project id or the longest
  message. The office checks in its tests that its own rules agree with them.
- **Raise `CONTRACT` when a studio built against the previous number would break:** a field removed or renamed,
  a type changed, a command's payload made stricter. Adding a field, a command or an event type does not.
