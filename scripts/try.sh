#!/usr/bin/env bash
# Start EVLMG Designer straight from the source code, to try new changes before a release.
#   ./scripts/try.sh            the newest main
#   ./scripts/try.sh <branch>   another branch, e.g. feat/card-designer-ui
# Close the installed app first: both can't run at the same time.
set -euo pipefail
cd "$(dirname "$0")/.."
branch="${1:-main}"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "This folder has changes that aren't committed. Commit or stash them first (git stash)."
  exit 1
fi
git fetch origin "$branch"
git checkout "$branch"
git pull --ff-only origin "$branch"
run='npm install --no-audit --no-fund && npm run tauri dev'
# NixOS: shell.nix brings Rust, Node and the system libraries the app needs.
if command -v nix-shell >/dev/null; then exec nix-shell --run "$run"; else exec bash -c "$run"; fi
