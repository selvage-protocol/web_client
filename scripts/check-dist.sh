#!/bin/sh
# Assert that a build of this repository reproduces the committed bundle.
#
#   scripts/check-dist.sh <COMMITTED_DIR> [BUILT_DIR]
#
# `COMMITTED_DIR` is the copy of `dist/` the commit carries, taken before
# `npm run build` overwrote it; `BUILT_DIR` defaults to `dist`. Both
# `.github/workflows/ci.yml` (the image ships the committed `dist/`, so a source
# change that was never rebuilt must not reach it) and `scripts/ci-local.sh` run this,
# so there is one place to keep the rule.
#
# Every file the bundler writes has to come back byte for byte: sha256 for both trees,
# compared in both directions, which catches a changed file and one the build emitted
# that the commit does not carry.
#
# The six sized icons are the exception, and what is asserted of them is what a
# renderer cannot change: the six names, at the six sizes. ImageMagick draws them at
# build time and its version decides everything else about the result — the PNG
# encoder's choices (compression level, chunk order) and, measurably, the resampler:
# this job carries trixie's 7.1.1.x, the committed icons came from 7.1.2, and 7% of the
# pixels of the 180px touch icon differ between the two while the picture is the same.
# `test/identity.test.ts` is where the icons' bytes are pinned, against a render by the
# machine it runs on, and it needs the `site` checkout beside this one.
#
# The verdict goes out as a GitHub annotation when `GITHUB_ACTIONS` is set, because a
# job's transcript is not readable from the API without a signed-in session.
#
# Needs `sha256sum`, `find`, `cmp`, `grep`, `wc` and `magick`. POSIX sh, because a `run:`
# step in a job container is executed by the container's own shell and this is the
# script that step calls.
set -eu

committed="${1:?usage: check-dist.sh <committed-dir> [built-dir]}"
built="${2:-dist}"

rendered='/(apple-touch-icon|favicon-16x16|favicon-32x32|icon-48|icon-192|icon-512)\.png$'
# name and the size the shell, the manifest and the site's own set serve it at
icons='apple-touch-icon.png:180x180 favicon-16x16.png:16x16 favicon-32x32.png:32x32 icon-48.png:48x48 icon-192.png:192x192 icon-512.png:512x512'

work="${TMPDIR:-.tmp}/check-dist"
mkdir -p "$work"

fail() {
    printf '%s\n' "$*" >&2
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '::error::%s\n' "$*"
    fi
    exit 1
}

[ -d "$committed" ] || fail "$committed is not a directory — the copy of the committed dist/"
[ -d "$built" ] || fail "$built is not a directory — run npm run build first"

# Every file's sha256 in a tree, one line each, file name last.
sums() {  # sums <dir> <out>
    (cd "$1" && find . -type f -exec sha256sum {} +) > "$2" || return 1
    sort -o "$2" "$2"
}

sums "$committed" "$work/committed.sums"
sums "$built" "$work/built.sums"

# A comparison that reached almost nothing would compare empty to empty and report a
# clean tree.
files="$(wc -l < "$work/built.sums")"
[ "$files" -ge 100 ] || fail "the built bundle holds $files files, so this comparison proves nothing"

if cmp -s "$work/committed.sums" "$work/built.sums"; then
    echo "reproduced byte for byte: $files files, none changed"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '::notice::a build here reproduces the committed dist/ byte for byte (%s files, none changed)\n' "$files"
    fi
    exit 0
fi

# What differs, in the commit's tree and in the built one.
only_committed="$(grep -vxF -f "$work/built.sums" "$work/committed.sums" || true)"
only_built="$(grep -vxF -f "$work/committed.sums" "$work/built.sums" || true)"
rest="$(printf '%s\n' "$only_committed" "$only_built" | grep -Ev "$rendered" || true)"
if [ -n "$rest" ]; then
    fail "a build does not reproduce the committed dist/: $(printf '%s' "$rest" | tr '\n' ' ' | cut -c1-600)"
fi

# An icon may be re-encoded or re-drawn by the renderer; it may not arrive at another
# size, and it may not be missing.
for entry in $icons; do
    icon="${entry%%:*}"
    want="${entry#*:}"
    have="$(magick identify -format '%wx%h' "$built/$icon" 2> /dev/null || true)"
    [ "$have" = "$want" ] || fail "the build rendered $icon at ${have:-nothing}, want $want"
done

echo "reproduced: $files files, every byte the bundler wrote, and the six rendered icons at their six sizes"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
    printf "::notice::a build here reproduces the committed dist/ (%s files, every byte the bundler wrote, the six rendered icons at their sizes; the renderer decides their bytes and pixels): re-encoded %s\n" \
        "$files" "$(printf '%s%s' "$only_committed" "$only_built" | tr '\n' ' ' | cut -c1-400)"
fi
