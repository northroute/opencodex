#!/bin/sh
# One-step OpenCodex setup: build this checkout locally and create a private,
# ready-to-run configuration. Safe to re-run; existing config and secrets are kept.
#
# Usage: scripts/setup.sh [opencodex setup options, e.g. --config <path>]
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool not found on PATH (Node.js >= 22 is required)" >&2
    exit 1
  fi
done

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ]; then
  echo "error: Node.js >= 22 is required (found $(node --version))" >&2
  exit 1
fi

# Local, lockfile-pinned install; no global packages, no install scripts.
npm ci --ignore-scripts --no-audit --no-fund
npm run build

exec node dist/index.js setup "$@"
