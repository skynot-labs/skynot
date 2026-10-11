# Keep this thin: language toolchains are devcontainer.json features; only search tools and Tailscale live here.
FROM mcr.microsoft.com/devcontainers/base:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ripgrep \
    fd-find \
    && rm -rf /var/lib/apt/lists/*

# Tailscale gives the office an HTTPS address reachable only from the director's own devices (docs/connecting-a-studio.md).
RUN curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg \
    && curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list \
    && apt-get update && apt-get install -y --no-install-recommends tailscale \
    && rm -rf /var/lib/apt/lists/*

# Debian ships fd as fdfind; give it the name every doc and muscle memory uses.
RUN ln -sf "$(which fdfind)" /usr/local/bin/fd
