#!/usr/bin/env bash
# The image's release identity, in the one place both jobs that need it read it:
# the non-pushing rehearsal and the publish job. `scripts/container-smoke.sh` reads
# the version from here too, so the label a pull request checks is the label a
# release publishes.
#
#   scripts/release-tags.sh [REF_NAME]
#
# Prints `version=`, `sha=` and `name=` lines, the shape `$GITHUB_OUTPUT` wants.
# The version comes from package.json and the sha from git, so the tag and the
# bundle inside it name the same revision. A `REF_NAME` that is a version tag must
# agree with package.json: a tag cut from the wrong commit would otherwise publish
# a mismatched version. A ref that is not one (a pull request's branch) has no
# version to agree with, so nothing is checked there — the tag run is where that
# rule is enforced.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

ref="${1:-}"
version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json | head -n 1)"
sha="$(git rev-parse --short HEAD)"

if [ -z "$version" ]; then
    echo "package.json names no version" >&2
    exit 1
fi

# The version becomes an image tag and is spliced into the workflows' shell steps, so it is
# held to the shape a release names before anything reads it: `MAJOR.MINOR.PATCH` with an
# optional `-prerelease` of letters, digits, dots and hyphens. A pull request that edits
# package.json is refused here rather than handing a quote or a `$(` to a `run:` block.
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "package.json version $version is not MAJOR.MINOR.PATCH[-prerelease]" >&2
    exit 1
fi

case "$ref" in
    v*)
        if [ "$ref" != "v$version" ]; then
            echo "tag $ref does not match the package.json version $version" >&2
            exit 1
        fi
        ;;
esac

printf 'version=%s\nsha=%s\nname=%s-%s\n' "$version" "$sha" "$version" "$sha"
