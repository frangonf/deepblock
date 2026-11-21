#!/usr/bin/env bash
set -euo pipefail

# GitHub checks out a PR's test merge commit. Its first parent is the base
# actually used for the merge, even if the PR branched from an older commit.
docs_only=true
git diff --quiet --no-renames HEAD^1 HEAD -- . \
  ':(top,exclude)docs/**' ':(top,exclude)README.md' ':(top,exclude)AGENTS.md' || {
  status=$?
  if [[ "$status" != 1 ]]; then exit "$status"; fi
  docs_only=false
}
printf 'docs-only=%s\n' "$docs_only" >> "$GITHUB_OUTPUT"
