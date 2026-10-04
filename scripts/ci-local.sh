#!/usr/bin/env bash
#
# Runs the steps of this repository's workflows on this machine, so a red job is
# found here rather than on a runner.
#
#   scripts/ci-local.sh checks     # the `checks` job: the dry_run guard's Python and the gating of the workflows
#                                 # that declare it, install, typecheck, build, the build reproduces dist/, the suite CI can run, the version bump leaves a tree this repository accepts, the release plan refuses what it must, the origin relay's config against SELVAGE_SERVER, every shell script parses, the links in README.md and docs/
#   scripts/ci-local.sh links      # the link check alone: lychee over README.md and docs/, to run it while editing prose
#   scripts/ci-local.sh container  # the `image` workflow's `container` job: docker build, a hardened run, the page asserted (needs Docker)
#   scripts/ci-local.sh all        # `checks`, which is what a push has to be green on
#
# There is no nix flake here: the checks are node's and lychee's, and the image is Docker's, so the
# modes are the workflows' local halves. Two of the steps are not Node's: the `dry_run` guard is
# Python with PyYAML, and the link check is lychee. Each workflow that runs them installs what they
# need into its container (Debian's `python3-yaml` for the guard, the pinned lychee release for the
# links, since that container has no nix for `run_lychee`'s fallback). This gate runs the guard on a
# `python3` that already imports the parser where there is one, building a venv for it under `.tmp/`
# only where there is none. Where a host has no
# Docker, `container` is the mode that runs on a runner, and the image
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

run_lychee() {
  if command -v lychee >/dev/null 2>&1; then
    lychee "$@"
  else
    nix shell nixpkgs#lychee -c lychee "$@"
  fi
}

# The interpreter the `dry_run` guard runs on, printed on stdout.
#
# A `python3` that already imports PyYAML is the shape both workflows that run these checks give
# their job — `node:22-trixie-slim` with Debian's `python3-yaml` — and the venv under `.tmp/` is
# this checkout's fallback for a machine that is not one of those: `pyyaml==6.0.2` is the version
# trixie's `python3-yaml` carries, so both shapes run the same parser. A host with neither is the
# refusal below rather than a skip, because a gate that passed over a check it could not run would
# report a green run it did not make.
guard_interpreter() {
  if python3 -B -c 'import yaml' 2>/dev/null; then
    # The resolved path rather than the word `python3`, so the section header names the
    # interpreter this actually ran on.
    command -v python3
    return 0
  fi
  local venv="$TMPDIR/dry-run-gating-venv"
  if [ ! -x "$venv/bin/python3" ]; then
    if ! python3 -m venv "$venv"; then
      printf 'refusing: the dry_run guard is Python and needs PyYAML, and this host has neither a `python3` that imports it nor one with the `venv` module to install it into; the check has not run, so this gate is not green\n' >&2
      return 1
    fi
    "$venv/bin/pip" install --quiet --disable-pip-version-check pyyaml==6.0.2
  fi
  printf '%s\n' "$venv/bin/python3"
}

job_checks() {
  # The `dry_run` guard is the one check here that is not Node's: it reads `.github/workflows`
  # back, so no suite below covers it, and it is Python. The check itself is the same
  # file `.github/workflows/ci.yml` runs, and the same file `release.yml`'s gate runs through this
  # mode, which is why both of those workflows install the interpreter it needs.
  say "checks: the dry_run guard's Python"
  guard_python="$(guard_interpreter)" || exit 1
  say "checks: the dry_run gating of the workflows that declare it, on $guard_python"
  "$guard_python" -B scripts/test_check_dry_run_gating.py
  "$guard_python" -B scripts/check_dry_run_gating.py .github/workflows
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
  # In a clone of its own, so a red run here leaves the tree above as it was.
  say "checks: the version bump, and the bundle it has to rebuild"
  scripts/test-bump-version.sh
  # A throwaway remote under `.tmp/`, for the same reason: the refusals are about tag state,
  # and those tags are made there rather than read from this checkout.
  say "checks: the release plan, against real tag states"
  scripts/test-release-plan.sh
  # The image's origin relay is written at startup by an entrypoint script from
  # `SELVAGE_SERVER`, so this runs that script directly and reads the nginx config it
  # feeds — and has an `nginx` parse that config where one is installed, which the
  # `checks` job's container has and this host may not: the `container` job is not the
  # first place a broken relay is seen, and a machine with no Docker can still check it.
  say "checks: the origin relay's config against SELVAGE_SERVER"
  scripts/test-relay-config.sh
  # Every shell script this repository has is under `scripts/`, and the release workflow is the
  # only thing that reaches some of them, so this parse is the last cheap place before a release
  # that they are read at all.
  say "checks: every shell script this repository has parses"
  for script in scripts/*.sh; do
    if [ ! -e "$script" ]; then
      printf 'scripts/*.sh matched nothing, so this check read no script at all\n' >&2
      exit 1
    fi
    printf '%s\n' "$script"
    bash -n "$script"
  done
  # The link check is over this repository's prose, which is `README.md` and the `docs/`
  # tree it indexes. The two are named rather than globbed so a docs file nobody links
  # to is read too, and every relative link has to resolve: a moved paragraph breaks one
  # silently, and no other step here reads either file.
  job_links
}

job_links() {
  say "links: lychee over README.md and docs/"
  run_lychee --config lychee.toml --no-progress README.md docs
}

job_container() {
  say "container: docker build, a hardened run, and the page asserted"
  scripts/container-smoke.sh
}

case "${1:-all}" in
  checks) job_checks ;;
  links) job_links ;;
  container) job_container ;;
  all) job_checks ;;
  *)
    printf 'usage: %s [checks|links|container|all]\n' "$0" >&2
    exit 2
    ;;
esac
