#!/usr/bin/env bash
# Re-runs on every rebuild: everything here must be idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

# Named volumes are created root-owned.
sudo chown "$(id -u):$(id -g)" node_modules data "$HOME/.claude" "$HOME/.codex"

# Push over HTTPS with the scoped token (see README), never through an SSH key.
git config --global url."https://github.com/".insteadOf "git@github.com:"

npm ci
npm install --global @anthropic-ai/claude-code @openai/codex
npm run build:console

echo ""
echo "  skynot ready. Log in once: claude, codex, and gh (see .devcontainer/README.md)."
echo "  Then: npm run dev"
echo ""
