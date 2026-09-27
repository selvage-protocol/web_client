#!/usr/bin/env bash
#
# What a release of this repository would be, and whether it is safe to cut.
#
#   scripts/release-plan.sh <patch|minor|major>
#
# Prints, in the shape a step appends to `$GITHUB_OUTPUT`:
#
#   current=0.5.1     the version package.json carries now
#   version=0.5.2     the version this dispatch would release
#   tag=v0.5.2        the tag it would create
#
# and refuses — having written nothing, committed nothing and created no tag — unless
# both halves of the release are in the state a click needs:
#
#   - the version package.json already carries **has a tag on the remote**. This is the
#     invariant that makes a second click safe: a bump that reached `main` while its tag
#     was never created leaves the manifest naming a version with no tag, and a
#     re-dispatch must refuse rather than compute the version after it and release twice.
#   - the tag for the version this dispatch would release **is not on the remote**. A tag
#     that is already there names a released version, and releasing it again is not a
#     re-run.
#
# Both answers are about the *remote*, read with `git ls-remote` and never taken from the
# local refs: a checkout can carry no tags at all — a shallow one carries none — while the
# remote is what refuses a release in every case. A remote that cannot be read is refused
# as that, with git's own words, rather than reported as a tag that is not there.
#
# The bump word's grammar belongs to `scripts/bump-version.sh`, which is also the one
# place the next version is computed and which refuses anything that is not `major`,
# `minor` or `patch` with its own message and exit status 2, before any tag is read here.
# Its exit statuses are this script's: 2 is the bump word, 1 is the remote's answer.
#
# `scripts/ci-local.sh checks` covers this through `scripts/test-release-plan.sh`.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

remote=origin
version_re='^[0-9]+\.[0-9]+\.[0-9]+$'

refuse() {  # refuse <message> [exit-status]
    printf 'release-plan.sh: %s\n' "$1" >&2
    # A red `run:` step is read from the API, where a job's transcript needs a
    # signed-in session; an annotation carries the reason to where it can be read.
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '::error::release-plan.sh: %s\n' "$1" >&2
    fi
    exit "${2:-1}"
}

remote_has_tag() {  # remote_has_tag <tag>: 0 when the remote carries it, 1 when it does not
    local out status=0
    out="$(git ls-remote --exit-code --tags "$remote" "refs/tags/$1" 2>&1)" || status=$?
    case "$status" in
        0) return 0 ;;
        # `--exit-code` answers 2 for "no refs matched", which is the whole question.
        2) return 1 ;;
        *) refuse "could not read the tags of $remote (git ls-remote exited $status, saying: ${out:-nothing})" ;;
    esac
}

[ "$#" -le 1 ] || refuse "too many arguments: want <major|minor|patch>, got $*" 2

bump="${1:-}"

# The manifest's version, read the way `scripts/release-tags.sh` reads it, and held to the
# shape a release names before it reaches a tag or a message.
current="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json | head -n 1)"
[[ "$current" =~ $version_re ]] ||
    refuse "package.json names '$current', which is not MAJOR.MINOR.PATCH, so there is no version to release"

if ! remote_has_tag "v$current"; then
    refuse "package.json names $current and $remote carries no tag v$current: the tag for this version never landed, and clicking release again would compute the version after it rather than release this one — create v$current and dispatch image.yml at it (docs/runbook-release.md §6) instead"
fi

# `bump-version.sh` computes it from the manifest, prints it as the last line of stdout and
# writes nothing with `--dry-run`; its own refusal about the bump word arrives here with
# its message and its exit status 2.
next="$(scripts/bump-version.sh "$bump" --dry-run | tail -n 1)"
[[ "$next" =~ $version_re ]] ||
    refuse "scripts/bump-version.sh printed '$next', which is not the version it is supposed to print"

if remote_has_tag "v$next"; then
    refuse "tag v$next already exists on $remote: that version is released, and a released version is not released again"
fi

printf 'current=%s\nversion=%s\ntag=v%s\n' "$current" "$next" "$next"
