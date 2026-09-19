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
# that the commit does not carry. The six sized icons are the exception, and they are
# checked as what they are, the *same images*: they are rendered at build time, and a
# PNG encoder's choices (compression level, chunk order) are the ImageMagick version's,
# not this repository's, so the same picture is different bytes under 7.1.1 and 7.1.2.
# `test/identity.test.ts` is where their bytes are pinned, on a machine that has the
# `site` checkout beside this one.
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

icons='apple-touch-icon.png favicon-16x16.png favicon-32x32.png icon-48.png icon-192.png icon-512.png'
rendered='/(apple-touch-icon|favicon-16x16|favicon-32x32|icon-48|icon-192|icon-512)\.png$'

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

# The icons may differ in bytes; they may not differ in picture.
for icon in $icons; do
    if ! magick compare -metric AE "$committed/$icon" "$built/$icon" null: 2> "$work/compare.txt"; then
        fail "the build re-rendered $icon as a different image: $(tr '\n' ' ' < "$work/compare.txt")"
    fi
done

echo "reproduced: $files files, every byte the bundler wrote, and the six rendered icons as the same images"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
    printf "::notice::a build here reproduces the committed dist/ (%s files, every byte the bundler wrote, the six rendered icons as the same images — their bytes are the encoder's): re-encoded %s\n" \
        "$files" "$(printf '%s%s' "$only_committed" "$only_built" | tr '\n' ' ' | cut -c1-400)"
fi
