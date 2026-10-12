# Connecting a studio to your office

Skynot has two halves. The **office** is the service you run: the Manager, the workers, the policy and the log.
The **studio** is the console you look at. An office always serves a studio of its own on the same machine, and
that needs none of this page. This page is for the other case: using a studio that lives somewhere else, such as
the public one at https://skynot-labs.github.io/skynot/studio/, or your phone, against your office.

**Status:** each piece was tried on its own, and the pairing is covered by tests that run two services against
each other. The whole path with the published studio and a real office has not been walked yet. Expect to fix
small things, and please report them.

## How it works

- **The office gets an address.** You tell it the address it is reached at with `SKYNOT_OFFICE_URL`. From then on
  every request needs a session, the ones from the office's own machine included.
- **A studio pairs once.** At start the office prints a pairing link. Opening it gives that browser a session,
  good for thirty days. The link is a password: whoever has it can run your shop and spend your quota.
- **Only your studio may call from a browser.** The office accepts calls from the pages of one studio, the public
  one unless you name another with `SKYNOT_STUDIO`.

Without `SKYNOT_OFFICE_URL` nothing changes: the office answers on its own machine only and asks for no session.

## The address

The office still listens only on `127.0.0.1`. Something on the same machine has to receive requests at the
address and pass them on, and the address has to be HTTPS: a browser will not let a public page call an office
over plain HTTP, and a session sent that way could be read on the way.

### With Tailscale, the private way

The office is reachable only from your own devices and never from the internet.

1. Install Tailscale on the office's machine and on the device you will browse from, and join both to the same
   tailnet. On the office's machine, let your user share ports:
   ```bash
   sudo tailscale up --operator=$USER
   ```
2. Start the office shared:
   ```bash
   npm run start:shared     # or npm run dev:shared for the simulated shop
   ```
   It asks Tailscale to share the console's port, takes the address Tailscale gives it, and prints the pairing
   link. When something is missing it stops and says what to run. The first time, that is a link from Tailscale
   to enable Serve and HTTPS certificates for your tailnet: open it, accept, and start again.
3. Open the pairing link, on a device of the tailnet.

The same by hand: `tailscale serve --bg 4747` prints the address, and
`SKYNOT_OFFICE_URL=https://my-machine.my-tailnet.ts.net npm run start` starts the office with it. The port stays
shared after the office stops; `tailscale serve reset` ends it.

Chrome asks once whether the studio may "access other devices on your local network", because a tailnet counts
as one; allow it. Safari asks nothing.

### With a public address

Any HTTPS address that forwards to `127.0.0.1:4747` works the same way: a tunnel, or a server with a domain and
a reverse proxy. Set `SKYNOT_OFFICE_URL` to it. The office is then on the internet, and the pairing secret is
the only thing in front of agents that run commands on that machine. Prefer the private way unless you need
this one, and run the office in the [devcontainer](../.devcontainer/README.md) or as its own user.

## Pairing by hand

The connection screen of a studio takes the same two things the link carries: the office's address and the
pairing secret. The secret is the content of `pairing.secret` in the office's data folder (`data/shop` unless
`SKYNOT_DATA` says otherwise).

## Ending sessions

- **One browser:** use Disconnect, next to the office's name at the bottom of the studio's sidebar. It forgets
  the session on that browser.
- **Every browser:** stop the office, delete `session.key` and `pairing.secret` from its data folder and start it
  again. Every session ends and a new pairing link is printed. Do this if a link may have been seen by someone
  else.

Five wrong secrets in a minute stop the office from listening to secrets for a minute.

## When it does not connect

- **The studio says the office speaks another contract.** The studio and the office were built from versions
  that no longer agree. The console the office itself serves always matches: open the office's own address.
- **"unknown host".** The office was reached at an address it was not told about. `SKYNOT_OFFICE_URL` must be
  exactly the address in the browser's bar, scheme included.
- **Chrome never asked, and the studio cannot reach the office.** The permission was refused earlier. Allow
  local network access for the studio in the site's settings and reload.
- **The public studio cannot reach an office on `http://127.0.0.1`.** Browsers block or gate that call. Use the
  console the office serves at http://127.0.0.1:4747 instead, or give the office an address as above.

## Your own studio

The studio is a static site. `npm run build:github && npm run build:studio` leaves it in
`console/dist/github/studio`, built to work from any folder of any host. Name its address in `SKYNOT_STUDIO` so
the office accepts its calls. The office and a studio agree on a contract number
(`packages/contract`), which the office reports at `/api/meta`.
