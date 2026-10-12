# @skynot/contract

What a studio and an office say to each other, and nothing else: the state the office reports, the commands it
accepts, the events it streams and the version of all three. To write another studio, or a client for the
terminal, start here: the shapes are all in this package. The paths other than the commands', the status codes and how a
session travels are not written down yet; read them in the office's `api.ts`.

It depends on nothing of the office or the studio. Both depend on it.

## Rules

- **The schema is the source.** Every shape is a zod schema named `SomethingSchema`; its type is inferred from it
  and exported as `Something`. The commands are the one exception: a single object, `commands`, from name to
  payload schema. No type is written by hand next to a schema.
- **An office may send more than the contract says.** Objects accept unknown keys, so adding a field never breaks
  a studio built earlier. For the state, the office's tests check the opposite direction too: that it sends
  nothing the contract does not name. A stream event still carries more than the contract names.
- **Identifiers are plain strings here.** The office's own branded types stay inside the office.
- **The contract owns the formats that cross the wire**, such as the shape of a project id or the longest
  message. The office checks in its tests that its own rules agree with them.
- **Raise `CONTRACT` when a studio built against the previous number would break:** a field removed or renamed,
  a type changed, a command's payload made stricter. Adding a field, a command or an event type does not.
