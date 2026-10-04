#!/usr/bin/env bash
#
# Moves this repository's version one step, in every file that carries it, and leaves
# the tree in the state this repository's own checks accept.
#
#   scripts/bump-version.sh <major|minor|patch> [--dry-run]
#
# The current version is read from this repository's own manifest and the next one is
# computed from the bump: `0.5.1` + `patch` -> `0.5.2`, + `minor` -> `0.6.0`, + `major`
# -> `1.0.0`. The resulting version is printed as the last line of stdout and nothing
# else is on that line, because the release workflow names the tag and the Release from
# it. Any other first argument — a version, including the `X.Y.Z` form; a misspelling;
# nothing at all — is refused with the reason and a non-zero exit, having changed
# nothing. `--dry-run` prints the same line and writes nothing.
#
# A run that fails once it has started writing puts every file it owns back, so a failed
# bump leaves the tree as it found it and a caller that tries again starts from the
# version it started from.
#
# The caller commits and tags: nothing here commits, tags or pushes, and nothing here
# touches a tag that already exists.
#
# Four places carry the version, each for its own reason:
#
#   package.json              the manifest, and this repository's version home in the
#                             release runbook: what `scripts/release-tags.sh` and the
#                             release workflows read.
#   package-lock.json         npm's copy of the manifest's version, in two fields —
#                             the root's own `version`, and the root entry's under
#                             `packages`.
#   src/browser/client-id.ts  the identity the page sends as `session.hello`'s
#                             `client`, `web_client/<version>`; a release that moves
#                             this and not the manifest is red in
#                             `test/client-identity.test.ts`.
#   dist/app.js               the generated bundle, which carries that identity.
#
# The fourth is why this is a script rather than a few edits the caller could make
# itself: `dist/` is committed and `scripts/check-dist.sh` asserts that a build
# reproduces the commit, so a bump that left the bundle naming the previous version
# would make this repository's own gate red. The build
# runs here instead, once, and every file the run moved is reported — a file that had
# fallen behind is named and repaired, never skipped.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

# `/tmp` is RAM-backed on some hosts and a build there has exhausted one before: keep
# every artefact inside the checkout.
export TMPDIR="$repo_root/.tmp"

manifest="package.json"
lockfile="package-lock.json"
identity="src/browser/client-id.ts"
bundle="dist/app.js"
work="$TMPDIR/bump-version"

note() {
    printf 'bump-version.sh: %s\n' "$*" >&2
    # A red `run:` step is read from the API, where a job's transcript needs a
    # signed-in session; an annotation carries the reason to where it can be read.
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '::error::bump-version.sh: %s\n' "$*" >&2
    fi
}

die() {  # die <message> [exit-status]
    note "$1"
    exit "${2:-1}"
}

# ---- the bump, and the version it resolves to --------------------------------------------

if [ "$#" -gt 2 ]; then
    die "too many arguments: want <major|minor|patch> [--dry-run], got $*" 2
fi

bump="${1:-}"
[ -n "$bump" ] || die "no bump given: pass major, minor or patch" 2

case "$bump" in
    major | minor | patch) ;;
    *)
        # This branch may hold a version rather than a misspelling of the bump word;
        # the two refuse with different messages, so say which one it is.
        if [[ "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            die "this takes a bump word, not a version: pass major, minor or patch, not $bump" 2
        fi
        die "the bump must be major, minor or patch: $bump is not" 2
        ;;
esac

dry_run=false
case "${2:-}" in
    "") ;;
    --dry-run) dry_run=true ;;
    *) die "the second argument must be --dry-run if it is given: $2 is not" 2 ;;
esac

# The manifest's version, read the way `scripts/release-tags.sh` reads it.
manifest_version() {
    sed -n 's/^  "version": "\(.*\)",$/\1/p' "$manifest" | head -n 1
}

# The lockfile's own two version fields, one per line: the root's and the root entry's
# under `packages`. Nothing else in the file is read, because every installed package
# carries a `version` of its own.
lockfile_version() {
    node -e '
const lock = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
process.stdout.write(`${lock.version ?? ""}\n${lock.packages?.[""]?.version ?? ""}\n`);
' "$lockfile"
}

identity_version() {
    sed -n 's|^export const CLIENT_ID = "web_client/\(.*\)";$|\1|p' "$identity" | head -n 1
}

current="$(manifest_version)"
[ -n "$current" ] || die "$manifest names no version to bump"

[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] ||
    die "$manifest names '$current', which is not MAJOR.MINOR.PATCH, so there is no version to move"

# `10#` so a part with a leading zero is read as decimal rather than refused as octal.
maj="$((10#${BASH_REMATCH[1]}))"
min="$((10#${BASH_REMATCH[2]}))"
pat="$((10#${BASH_REMATCH[3]}))"
case "$bump" in
    major) next="$((maj + 1)).0.0" ;;
    minor) next="$maj.$((min + 1)).0" ;;
    patch) next="$maj.$min.$((pat + 1))" ;;
esac

if [ "$dry_run" = true ]; then
    printf 'bump-version.sh: %s %s -> %s (dry run; nothing written)\n' "$bump" "$current" "$next"
    printf '%s\n' "$next"
    exit 0
fi

# ---- set it, then rebuild the bundle ------------------------------------------------------

for tool in node npm magick; do
    command -v "$tool" > /dev/null 2>&1 ||
        die "$tool is not on PATH; the manifests are written with node and the bundle's icons are rendered with ImageMagick 7's magick"
done

# Fresh scratch every run. A leftover copy from an earlier run would be restored in
# place of this one, and `cp -r` into an existing directory nests it.
rm -rf "$work"
mkdir -p "$work"

# Everything from the first write on is put back if anything fails, so a run that fails
# leaves the tree as it found it and a caller that tries again starts from the version it
# started from rather than from three files further along. The bundle is restored too,
# because `npm run build` empties `dist/` before it fills it again and a build that fails
# halfway leaves it in neither state.
kept="$work/kept"
mkdir -p "$kept"
cp -- "$manifest" "$kept/manifest"
cp -- "$lockfile" "$kept/lockfile"
cp -- "$identity" "$kept/identity"
kept_dist=false
if [ -d dist ]; then
    kept_dist=true
    cp -r dist "$kept/dist"
fi

writes_started=false
put_everything_back() {
    local status=$?
    if [ "$status" -eq 0 ] || [ "$writes_started" = false ]; then
        return 0
    fi
    cp -- "$kept/manifest" "$manifest"
    cp -- "$kept/lockfile" "$lockfile"
    cp -- "$kept/identity" "$identity"
    rm -rf dist
    if [ "$kept_dist" = true ]; then
        cp -r "$kept/dist" dist
    fi
    note "the run failed, so $manifest, $lockfile, $identity and dist/ are as they were"
    return 0
}
trap put_everything_back EXIT

# `path<TAB>sha256` for every file whose bytes this script owns: the three it writes and
# the generated tree. Compared afterwards rather than asked of git, so a checkout that
# was already dirty reports only what this run moved — a file that was behind shows up
# here as moved, rather than passing for one already at the version.
snapshot() {  # snapshot <out>
    local out="$1" file
    : > "$out"
    for file in "$manifest" "$lockfile" "$identity"; do
        [ -f "$file" ] || continue
        sha256sum -- "$file" | awk -v OFS='\t' '{ print $2, $1 }' >> "$out"
    done
    if [ -d dist ]; then
        find dist -type f -exec sha256sum {} + | awk -v OFS='\t' '{ print $2, $1 }' >> "$out"
    fi
    return 0
}

# The paths whose hash differs between the two snapshots, and the ones the second
# snapshot no longer has.
changed_paths() {  # changed_paths <before> <after>
    awk -F'\t' '
        FNR == 1 { which++ }
        which == 1 { was[$1] = $2; next }
        { seen[$1] = 1; if (($1 in was) && was[$1] == $2) next; print $1 }
        END { for (file in was) if (!(file in seen)) print file }
    ' "$1" "$2"
}

snapshot "$work/before"

writes_started=true

# JSON, not `sed`: `package-lock.json` carries a `version` for every installed package
# as well as its own two, and only the two are the manifest's. npm's own formatting is
# 2-space and a trailing newline, which is what this writes back.
node -e '
const { readFileSync, writeFileSync } = require("node:fs");
const [, ...args] = process.argv;
const version = args.shift();
for (const file of args) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.version = version;
    if (json.packages && json.packages[""]) json.packages[""].version = version;
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
' "$next" "$manifest" "$lockfile"

sed -i "s|^export const CLIENT_ID = \"web_client/.*\";\$|export const CLIENT_ID = \"web_client/$next\";|" \
    "$identity"

[ "$(manifest_version)" = "$next" ] || die "$manifest did not take $next"
[ "$(lockfile_version)" = "$next"$'\n'"$next" ] || die "$lockfile did not take $next"
[ "$(identity_version)" = "$next" ] || die "$identity did not take $next"

# `npm ci` is what CI installs with, and it is a network install, so it runs only when
# there is nothing here to build with already.
if [ ! -x node_modules/.bin/esbuild ] || [ ! -d node_modules/monaco-editor ]; then
    printf 'bump-version.sh: no usable node_modules; running npm ci\n'
    npm ci --no-audit --no-fund || die "npm ci failed"
fi

# Quiet on success: the build lists the whole bundle, and what a caller needs back is
# which files moved.
if ! npm run build > "$work/build.log" 2>&1; then
    cat "$work/build.log" >&2
    die "npm run build failed, so $bundle is stale while the three files above are not; fix the build and run this again"
fi

# The identity as a page carries it. The trailing character that is not a digit or a
# dot is what keeps `web_client/0.5.1` from matching a bundle built for `0.5.10`.
identity_re="web_client/${next//./\\.}([^0-9.]|\$)"
if [ ! -f "$bundle" ] || ! grep -qE -- "$identity_re" "$bundle"; then
    die "$bundle does not carry web_client/$next after a build"
fi

snapshot "$work/after"
mapfile -t changed < <(changed_paths "$work/before" "$work/after")
[ "${#changed[@]}" -gt 0 ] ||
    die "no file moved, yet the tree names $current and not $next — refusing to report a bump that did not happen"

printf 'bump-version.sh: %s %s -> %s, in:\n' "$bump" "$current" "$next"
printf '  %s\n' "${changed[@]}"
printf '%s\n' "$next"
