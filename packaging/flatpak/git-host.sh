#!/bin/bash
# The sandbox has no git, and the user's GitHub login lives outside it, so Git sync runs the computer's own git.
args=(--host --watch-bus "--directory=$(pwd -P)")
for v in GIT_TERMINAL_PROMPT GIT_SSH_COMMAND; do
  [ -n "${!v}" ] && args+=("--env=$v=${!v}")
done
exec flatpak-spawn "${args[@]}" git "$@"
