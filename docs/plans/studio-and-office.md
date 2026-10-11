# Plan · A public studio, and an office anyone can run

**Status:** draft for the director's review. Nothing here is decided or built. See [vision](../vision.md) for what
exists, and [running on a server](../running-on-a-server.md) for the only remote setup that works today.

## Why

Skynot is public, and trying it for real means cloning it, building a console and working through a guide. The
director wants a stranger to get from the README to a working shop with very little invested, and wants the two
halves, what you see and what does the work, to be separate things with a contract between them: someone can
replace the console, drive the office from a script, or rewrite either side. Meeting the problems a real product
meets, releases and a contract that cannot break silently, is part of the goal.

This is not a competitor to `claude` or `codex`. It is a small, readable project to play with and take ideas from.

## What a newcomer does when this is done

1. Opens the public studio on GitHub Pages and sees a shop working, simulated, with nothing installed.
2. Clones the repository and runs one setup command. It creates their GitHub App with the right permissions,
   writes the three configuration files and runs the readiness check.
3. Starts the office. It prints a link; opening it connects the public studio to their office.

The office runs on their own machine. A tunnel is only for reaching it from another device.

## Proposed decisions

None is taken; each is here to be argued with.

1. **Two deployables and a contract.** The **studio** is the static console. The **office** is the service: the
   Manager, the orchestrator, the policy and the event log. The **contract** is what they exchange: the state, the
   commands and the event stream, written as schemas and versioned on its own.
2. **The contract is language-neutral.** The zod schemas are the source; JSON Schema is generated from them. The
   studio stops importing types from the office's code, and a test keeps it that way.
3. **The office says what it speaks.** The studio checks the contract's major version when it connects and says
   so when they differ, instead of failing inside a view.
4. **Local first.** The public studio talks to the office on `127.0.0.1`. Nothing is exposed to the internet by
   default.
5. **A pairing token, not a login.** The office creates a token at first start and prints a link that carries it.
   One director, one token, revocable. No password, no JWT, no user table until there is a second user.
6. **The office keeps a studio of its own.** It still serves a console built from the same commit, on the same
   origin. That is what works offline, in a browser that blocks the public one, and when versions differ.
7. **One repository until the contract has changed once.** Three packages with the boundary enforced by a test and
   released separately. Separate repositories come after the first breaking change shows what a release costs.

## To validate before building

Cheap experiments. A failure changes the plan, so they come first.

| # | Assumption | Status |
| --- | --- | --- |
| 1 | A page served over HTTPS can call an office on `http://127.0.0.1`, including the event stream, in Chrome and Firefox | not checked |
| 2 | What Safari does with the same call, and what recent Chrome asks the user to allow | not checked; a similar project reports Safari blocks it and Chrome 142 asks for a permission |
| 3 | A GitHub App can be created from a manifest with the callback on `127.0.0.1`, returning its id and private key | not checked |
| 4 | The event stream survives a free tunnel for an hour without dropping silently | not checked; the same project calls such tunnels unreliable |
| 5 | The simulated shop can run inside the browser, for the public demo | not checked; it reads files today |

## Slices

Each is delivered and tried before the next is planned in detail.

**A · The contract.** Schemas for the state, every command and the events; a version; an endpoint that reports it.
The office's real answers are checked against the schemas in its tests. The console builds from the contract
alone. **Done when** deleting the console's access to the office's source breaks nothing, and a field removed from
the state fails a test on both sides.

**B · An office that accepts a studio from elsewhere.** The token, the list of origins allowed to call, and a
stream that carries the token. The bundled console keeps working with no setup. **Done when** a console served from
another origin runs an order from idea to pull request, and a request without the token, or from an origin not on
the list, is refused.

**C · A studio that connects.** A connection screen, the pairing link, the version check, and the studio published
on Pages next to the public site. **Done when** the director runs a real order from the public studio against the
office on their machine.

**D · Set up in minutes.** One command that creates the GitHub App, writes the configuration, runs the check and
prints the link. The getting started guide is rewritten around it and timed by someone who has never seen the
project. **Done when** that person has a shop answering in under ten minutes, not counting the engine login.

**E · The demo.** The public studio shows a simulated shop when it is not connected to an office. **Done when** a
visitor walks an order through without installing anything.

## Not in this plan

A login with GitHub, more than one director, a node that lends engines to an office, an administration screen,
another language for the office, and separate repositories. Each waits for a pain that asks for it.

## Risks

- **The token is the only wall** in front of agents that run commands on someone's machine. A leaked link is a
  leaked shop. It needs revocation and a limit on attempts, and the guide must say plainly what it protects.
- **One public studio serves everyone.** A script injected into it reaches every office connected to it. It needs
  a strict content policy, no third-party scripts, and the token kept out of anything a script can read later.
- **Browsers are closing this door.** Calling a local address from a public page is being restricted. If slice C
  only works in one browser, the bundled console becomes the main path and the public studio the demo.
- **Two things to release instead of one.** Every change that touches both sides becomes two releases in the right
  order. That is the lesson wanted, and it is also the cost.
- **The setup command touches someone's GitHub account.** It must show what it will create before it does, and
  leave nothing behind when it fails halfway.

## Open for the director

- Does this go before greenfield and curated memory in the [roadmap](../vision.md#phases), and replace the deploy
  half of phase 7?
- If browsers block the local call, is a public studio that is mostly a demo still worth slices C and E?
- One repository first, or three from the start?
