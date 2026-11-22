#!/usr/bin/env bash
set -euo pipefail

# GitHub checks out a PR's test merge commit. Its first parent is the base
# actually used for the merge, even if the PR branched from an older commit.
# If the comparison fails, run the full suite rather than skipping checks.
lightweight_only=false
if git diff --quiet --no-renames HEAD^1 HEAD -- . \
  ':(top,exclude)docs/**' ':(top,exclude)README.md' ':(top,exclude)AGENTS.md' \
  ':(top,exclude).gitignore'; then
  lightweight_only=true
fi
printf 'lightweight-only=%s\n' "$lightweight_only" >> "$GITHUB_OUTPUT"
