#!/usr/bin/env bash
# Assert that a running page image serves the page this checkout's `dist/` holds.
#
#   scripts/check-page.sh <BASE_URL> [DIST_DIR]
#
# Four groups, because a static layer can be wrong in four ways: the port never
# answers; a file's media type is not the page's table (a hashed chunk answered as
# `text/html` blocks the module load, which is the defect the page's own
# `scripts/check-content-types.mjs` exists for, over its `EXPECTED_TYPES`); the
# bytes are not the ones `dist/` holds (a stale or truncated copy answers 200 with
# the wrong hash, which a status check cannot see); and the headers are not the
# ones the one-origin deployment decides (the cache policy the name carries,
# no-referrer, nosniff, and the page's own policy). It also asserts the shape: a
# write is refused, and `/meta` and `/session` are not served here.
#
# Needs curl, sha256sum and node. Shared by `scripts/container-smoke.sh` and
# `scripts/assert-image-page.sh`, so the pull request's proof and the release's
# read-back assert the same thing.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

base="${1:?usage: check-page.sh <base-url> [dist-dir]}"
base="${base%/}"
dist="${2:-$repo_root/dist}"

work="${TMPDIR:-$repo_root/.tmp}/check-page"
rm -rf "$work"
mkdir -p "$work"

fail() {
    printf '%s\n' "$*" >&2
    # A red run is read from the API, where a job's transcript is not readable without
    # a signed-in session; an annotation carries the reason to where it can be read.
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '::error::%s\n' "$*"
    fi
    exit 1
}

for tool in curl sha256sum node; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "check-page.sh needs $tool, which this host does not have" >&2
        exit 2
    fi
done

[ -d "$dist" ] || fail "$dist is not a directory — build the page first"
[ -f "$dist/index.html" ] || fail "$dist holds no index.html"

# A bounded wait on the page itself, so the two callers do not each invent one. The
# last observed status is reported rather than a sleep's worth of hope.
deadline=$((SECONDS + 30))
last=""
until last="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$base/" 2>&1)"; do
    [ "$SECONDS" -lt "$deadline" ] || fail "$base/ did not answer within 30s (last: $last)"
    sleep 0.5
done

echo "=== types: every file in dist/, served with the type the table gives it ==="
node scripts/check-content-types.mjs "$base" || fail "the served media types are not the page's table"

echo "=== bytes: what is served is what dist/ holds ==="
same() {
    local path="$1" file="$2" want have
    curl -sS --fail --max-time 10 -o "$work/served" "$base$path" || fail "GET $base$path failed"
    want="$(sha256sum "$dist/$file" | cut -d' ' -f1)"
    have="$(sha256sum "$work/served" | cut -d' ' -f1)"
    [ "$want" = "$have" ] || fail "$path serves $have, but dist/$file is $want"
    echo "bytes ok: $path == dist/$file ($have)"
}

same / index.html
same /app.js app.js
same /site.webmanifest site.webmanifest

# A content-hashed chunk, named by the bundle the image carries rather than by this
# script: its name is the hash of its bytes, so it cannot change under that name. An
# extraction that found nothing would otherwise report the page clean without having
# read it.
chunk="$(grep -o 'lang-[A-Za-z0-9_-]\{8,\}\.js' "$dist/app.js" | head -n 1 || true)"
[ -n "$chunk" ] || fail "dist/app.js names no content-hashed chunk, so it is not the bundler's output"
same "/$chunk" "$chunk"

echo "=== headers: the cache policy the name carries, and the hardening ==="
headers() {
    curl -sS --fail --max-time 10 -D "$work/$2.headers" -o /dev/null "$base$1" || fail "GET $base$1 failed"
}

require_header() {
    grep -qiF -- "$2" "$work/$1.headers" || {
        cat "$work/$1.headers" >&2
        fail "$1: the response carries no '$2'"
    }
}

headers / shell
headers "/$chunk" chunk
headers /site.webmanifest manifest

require_header shell "content-type: text/html; charset=utf-8"
require_header shell "cache-control: no-cache"
require_header shell "referrer-policy: no-referrer"
require_header shell "x-content-type-options: nosniff"
require_header shell "content-security-policy: default-src 'none';"
require_header chunk "content-type: text/javascript; charset=utf-8"
require_header chunk "cache-control: public, max-age=31536000, immutable"
require_header manifest "content-type: application/manifest+json; charset=utf-8"
echo "headers ok: the shell revalidates, a hashed chunk is pinned, the policy and the hardening are the page's"

echo "=== shape: the page and nothing else ==="
status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' -X POST "$base/")"
[ "$status" = "403" ] || fail "a POST to the page answered $status, want 403"
echo "a write is refused: POST is $status"
for path in /meta /session; do
    status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$base$path")"
    [ "$status" = "404" ] || fail "$path answers $status; this image serves the page and no endpoint"
    echo "not served: $path is $status"
done

echo "page OK: $base serves dist/ byte for byte, typed and hardened"
