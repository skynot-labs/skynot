#!/usr/bin/env bash
# Runs on every start of the container: must be safe to run twice.
set -euo pipefail

command -v tailscaled >/dev/null || exit 0
pgrep -x tailscaled >/dev/null && exit 0

# No /dev/net/tun in the container, so Tailscale runs without a network interface. `tailscale serve` still works;
# programs in the container cannot open connections into the tailnet.
sudo sh -c 'nohup tailscaled --tun=userspace-networking --statedir=/var/lib/tailscale >/var/log/tailscaled.log 2>&1 &'
