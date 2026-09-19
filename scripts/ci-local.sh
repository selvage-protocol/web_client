#!/usr/bin/env bash
#
# Runs the steps of this repository's workflows on this machine, so a red job is
# found here rather than on a runner.
#
#   scripts/ci-local.sh checks     # the `checks` job: install, typecheck, build, the build reproduces dist/, the suite CI can run
#   scripts/ci-local.sh container  # the `image` workflow's `container` job: docker build, a hardened run, the page asserted (needs Docker)
#   scripts/ci-local.sh all        # `checks`, which is what a push has to be green on
#
# There is no nix flake here: the checks are node's and the image is Docker's, so the
# two modes are the two workflows' local halves and nothing else. This host has no
# Docker at all, so `container` is the mode that runs on a runner, and the image
# workflow's `publish-rehearsal` and `publish` (multi-architecture buildx) have no
# step here either: they are read from the run, and their logic lives in
# `scripts/release-tags.sh` and `scripts/assert-image-page.sh`, which the local
# `container` mode and those two jobs share.
#
# Keep this in step with the workflows — it runs the same commands. `checks` uses this
# host's node and ImageMagick; the workflow runs the same commands in
# `node:22-trixie-slim` with trixie's imagemagick, because that is where ImageMagick
# 7's `magick` is and the build shells out to it for the sized icons.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

# `/tmp` is RAM-backed on some hosts and a build there has exhausted one before: keep
# every artefact inside the checkout.
export TMPDIR="$repo_root/.tmp"
mkdir -p "$TMPDIR"

say() { printf '\n=== %s ===\n' "$*"; }

job_checks() {
  say "checks: install"
  npm ci --no-audit --no-fund
  say "checks: typecheck"
  npm run typecheck
  # The commit's own `dist/`, before the build overwrites it: the same comparison the
  # workflow's step makes, through the same script.
  say "checks: keep the committed dist/ to compare against"
  rm -rf "$TMPDIR/dist-committed"
  cp -r dist "$TMPDIR/dist-committed"
  say "checks: build"
  npm run build
  say "checks: the build reproduces the committed dist/"
  scripts/check-dist.sh "$TMPDIR/dist-committed"
  say "checks: the suite CI can run"
  npm run test:ci
}

job_container() {
  say "container: docker build, a hardened run, and the page asserted"
  scripts/container-smoke.sh
}

case "${1:-all}" in
  checks) job_checks ;;
  container) job_container ;;
  all) job_checks ;;
  *)
    printf 'usage: %s [checks|container|all]\n' "$0" >&2
    exit 2
    ;;
esac
