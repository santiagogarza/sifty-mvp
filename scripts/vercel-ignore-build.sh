#!/usr/bin/env bash
# Vercel "Ignored Build Step" (see vercel.json `ignoreCommand`).
#
# Exit 1 = build, exit 0 = skip. Only the production branch and production
# worker branches (`cursor/prod-*`) build; `master`, the demo branches, and
# demo-agent PRs never do, so preview env vars never reach demo code.
set -u

ref="${VERCEL_GIT_COMMIT_REF:-}"

case "$ref" in
  production|cursor/prod-*)
    echo "vercel-ignore-build: building $ref"
    exit 1
    ;;
  *)
    echo "vercel-ignore-build: skipping ${ref:-<no ref>} (only production and cursor/prod-* build)"
    exit 0
    ;;
esac
