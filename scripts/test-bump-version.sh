#!/usr/bin/env bash
#
# Covers `scripts/bump-version.sh`. Everything runs in a throwaway clone under
# `.tmp/`, so nothing here can reach this checkout.
#
#   scripts/test-bump-version.sh
#
# Eight properties:
#
#   - anything that is not one of `major`, `minor`, `patch` — nothing at all, a
#     version such as `0.5.1` or `1.2.3.4`, a misspelling, `--dry-run` in the bump's
#     place, a second argument that is not `--dry-run`, a third argument — is refused
#     with a message naming it, exit 2, and the tree untouched afterwards, down to not
#     creating the scratch directory;
#   - the next version is computed from the manifest rather than from anything else, so
#     a patch on a manifest whose patch is nine is a two-digit one and not `20`, and a
#     minor and a major carry into the next minor and the next major;
#   - a manifest version that is not three numbers is refused, with the version named;
#   - the resulting version is the last line of stdout and nothing else is on it,
#     because the release workflow names the tag and the Release from it;
#   - `--dry-run` prints that line and writes nothing, in both of the states it can be
#     called in;
#   - the write mode moves exactly the files that carry the version — the manifest, the
#     lockfile, the page's identity and the generated bundle — and nothing else in the
#     tree, commits nothing and tags nothing, and the run after it reads the manifest
#     again rather than remembering the version;
#   - a file that has fallen behind is repaired and named, never skipped, and a build
#     still reproduces the committed `dist/` afterwards (`scripts/check-dist.sh`),
#     which is the property the release workflow depends on;
#   - a run that fails after it has started writing leaves the tree as it found it.
#
# The six sized icons are outside that file set, and deliberately: ImageMagick renders
# them at build time and its version decides their bytes, so a runner carrying trixie's
# 7.1.1.x re-encodes what this checkout's 7.1.2 committed. `scripts/check-dist.sh`
# excludes exactly those six from its byte comparison for the same reason, asserting
# only their names and sizes, and this check makes the same exclusion — the file set
# asserted here is then the same one on a runner and in a checkout. Everything the
# exclusion does not cover is compared whole, so a script that starts editing something
# else still fails.
#
# `scripts/ci-local.sh checks` runs this.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

work="$repo_root/.tmp/bump-version-test"
tree="$work/tree"

# The exact tree a write-mode bump leaves: those four files, modified, and nothing else
# — no untracked scratch, no fifth file, no file this repository does not keep the
# version in. `git status` is compared whole rather than probed per file for that
# reason, so a script that starts editing something else fails here.
expected_bump=" M dist/app.js
 M package-lock.json
 M package.json
 M src/browser/client-id.ts"

say() { printf '\n=== %s ===\n' "$*"; }
fail() {
    printf '%s\n' "$*" >&2
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '%s\n' "::error::$*"
    fi
    exit 1
}

status() { git -C "$tree" status --porcelain -uall; }

# The six the renderer decides, the same expression `scripts/check-dist.sh` uses.
rendered='/(apple-touch-icon|favicon-16x16|favicon-32x32|icon-48|icon-192|icon-512)\.png$'
moved() { status | grep -Ev "$rendered" || true; }

bump() { "$tree/scripts/bump-version.sh" "$@"; }

# `stdout` and `stderr` are kept apart, not merged: `expect_last` is about the line a
# caller names the tag from, which is stdout alone, and a refusal's `::error::`
# annotation belongs in the message being asserted on rather than replayed into this
# run's transcript. `last` is the last line of stdout.
stdout=""
stderr=""
last=""
code=0
run() {  # run <args...>
    stdout="$("$tree/scripts/bump-version.sh" "$@" 2> "$work/stderr")" && code=0 || code=$?
    stderr="$(cat "$work/stderr")"
    last="$(printf '%s\n' "$stdout" | tail -n 1)"
}

expect_clean() {  # expect_clean <label>
    local have
    have="$(status)"
    [ -z "$have" ] || fail "$1: the tree changed:
$have"
}

expect_status() {  # expect_status <label> <expected>
    local have
    have="$(moved)"
    if [ "$have" != "$2" ]; then
        fail "$1: the tree holds
${have:-nothing}
want exactly
$2
everything git reports, the six rendered icons included:
$(status)"
    fi
}

expect_last() {  # expect_last <label> <expected-version>
    [ "$code" -eq 0 ] || fail "$1: exit status $code, and it said on stderr:
$stderr"
    [ "$last" = "$2" ] || fail "$1: stdout's last line is '$last', want '$2'; stdout was:
$stdout
stderr was:
$stderr"
}

expect_named() {  # expect_named <label> <path>
    case "$stdout" in
        *"$2"*) ;;
        *) fail "$1: it did not report $2 as moved; stdout was:
$stdout" ;;
    esac
}

# The manifest's own version, read the way `scripts/release-tags.sh` reads it.
manifest_version() { sed -n 's/^  "version": "\(.*\)",$/\1/p' "$1/package.json" | head -n 1; }

# Writes a version straight into the clone's manifest, so a case can start from a known
# one. Only the manifest: a run that then does nothing leaves exactly one modified file.
seed_manifest() {  # seed_manifest <version>
    sed -i "s/^  \"version\": \".*\",\$/  \"version\": \"$1\",/" "$tree/package.json"
}

say "a throwaway clone, so a failure here cannot reach this checkout"
rm -rf "$work"
mkdir -p "$work"
git clone --quiet --no-hardlinks "$repo_root" "$tree" ||
    fail "could not clone $repo_root into $tree"

# A symlink is not enough, and this is worth knowing before changing it: the build's
# sourcemaps name `node_modules` relative to `dist/`, so a symlinked `node_modules`
# moves that path, changes the content hash of every chunk, and a build stops
# reproducing the committed bundle. Hard links keep the paths real and cost nothing.
cp -al "$repo_root/node_modules" "$tree/node_modules" ||
    fail "could not give the clone a node_modules to build with"

# The script under test is the working tree's, and a clone carries commits: until this
# change lands, the script is not one. Committing it into the clone is what makes the
# `git status` above — and so every assertion below — the bump's own doing and nothing
# else. Only the script is taken from the working tree.
cp "$repo_root/scripts/bump-version.sh" "$tree/scripts/bump-version.sh"
git -C "$tree" add -- scripts/bump-version.sh
if ! git -C "$tree" diff --cached --quiet; then
    GIT_EDITOR=true git -C "$tree" \
        -c user.name=DontBlameMe -c user.email=dontblameme@noreply.codeberg.org \
        commit --quiet -m "the script under test" ||
        fail "could not commit the script under test into the clone"
fi
expect_clean "before any call"
head_before="$(git -C "$tree" rev-parse HEAD)"
tags_before="$(git -C "$tree" tag -l --format='%(refname:short) %(objectname)')"

current="$(manifest_version "$tree")"
[ -n "$current" ] || fail "the clone's package.json names no version"
IFS=. read -r cur_major cur_minor cur_patch <<< "$current"
want_patch="$cur_major.$cur_minor.$((10#$cur_patch + 1))"
want_minor="$cur_major.$((10#$cur_minor + 1)).0"
want_major="$((10#$cur_major + 1)).0.0"
printf 'the clone is at %s\n' "$current"

say "anything that is not a bump word is refused, and changes nothing"
# `<bump>` and, when there is one the refusal has to name, the argument that must appear
# in the message. A refusal that does not say which argument it refused is as bad as one
# that exits 0: the release workflow is automated and nobody reads the transcript first.
check_refusal() {  # check_refusal <bump-argument-1> <bump-argument-2|-> <must-name|->
    local label="$1" second="$2" must="$3" shown
    if [ "$second" = "-" ]; then
        shown="'$label'"
        run "$label"
    else
        shown="'$label $second'"
        run "$label" "$second"
    fi
    [ "$code" -eq 2 ] || fail "$shown exited $code; want the refusal's 2"
    [ -n "$stderr" ] || fail "$shown was refused with no message"
    if [ "$must" != "-" ]; then
        case "$stderr" in
            *"$must"*) ;;
            *) fail "the refusal of $shown does not name '$must': $stderr" ;;
        esac
    fi
    expect_clean "after refusing $shown"
    printf 'refused %-30s exit %s: %s\n' "$shown" "$code" "$stderr"
}

check_refusal "" - -
check_refusal "$current" - "$current"
check_refusal "v$current" - "v$current"
check_refusal "1.2.3.4" - "1.2.3.4"
check_refusal "PATCH" - "PATCH"
check_refusal "latest" - "latest"
check_refusal "--dry-run" - "--dry-run"
check_refusal "patch" "--force" "--force"
check_refusal "patch" "extra" "extra"
check_refusal "minor" "patch --dry-run" "patch --dry-run"

# A third argument is one too many, whichever it is.
run patch --dry-run --dry-run
[ "$code" -eq 2 ] || fail "three arguments exited $code; want the refusal's 2"
case "$stderr" in
    *"patch --dry-run --dry-run"*) ;;
    *) fail "the refusal of three arguments does not name them: $stderr" ;;
esac
expect_clean "after refusing three arguments"
printf 'refused %-30s exit %s: %s\n' "'patch --dry-run --dry-run'" "$code" "$stderr"

# No argument at all is a different thing from an empty one, and neither is a bump.
run
[ "$code" -eq 2 ] || fail "no argument at all exited $code; want the refusal's 2"
[ -n "$stderr" ] || fail "no argument at all was refused with no message"
expect_clean "after refusing no argument at all"
printf 'refused %-30s exit %s: %s\n' "(none)" "$code" "$stderr"

say "--dry-run computes the next version and writes nothing"
for pair in "patch:$want_patch" "minor:$want_minor" "major:$want_major"; do
    run "${pair%%:*}" --dry-run
    expect_last "--dry-run ${pair%%:*}" "${pair#*:}"
    expect_clean "after --dry-run ${pair%%:*}"
    printf '%-6s -> %-8s (last line of stdout)\n' "${pair%%:*}" "$last"
done

say "the next version is computed from the manifest, carrying when it has to"
# A seed that is never the version the manifest already carries, so this case always
# moves something: the minor is one past the current one. Its patch is the nine that
# makes a patch bump a two-digit number, which is where a version written as a string
# rather than counted goes wrong.
seed="$cur_major.$((10#$cur_minor + 1)).9"
seed_patch="$cur_major.$((10#$cur_minor + 1)).10"
seed_minor="$cur_major.$((10#$cur_minor + 2)).0"
seed_major="$((10#$cur_major + 1)).0.0"
seed_manifest "$seed"
expect_status "after seeding the manifest" " M package.json"
for pair in "patch:$seed_patch" "minor:$seed_minor" "major:$seed_major"; do
    run "${pair%%:*}" --dry-run
    expect_last "from $seed, --dry-run ${pair%%:*}" "${pair#*:}"
    # The lockfile and the identity source are behind the seeded manifest, and a dry run
    # still leaves them exactly as they were.
    expect_status "after --dry-run ${pair%%:*}" " M package.json"
    printf '%s + %-6s -> %-8s (last line of stdout)\n' "$seed" "${pair%%:*}" "$last"
done

say "a manifest version that is not three numbers is refused"
seed_manifest 0.5
run patch
[ "$code" -eq 1 ] || fail "a two-part manifest version exited $code; want a refusal"
case "$stderr" in
    *0.5*) ;;
    *) fail "the refusal does not name the manifest's version 0.5: $stderr" ;;
esac
expect_status "after refusing a two-part manifest version" " M package.json"
printf 'refused from a manifest of 0.5, exit %s: %s\n' "$code" "$stderr"

# Put the clone back where it was, so the write-mode cases below run against the state
# this repository is actually in.
seed_manifest "$current"
expect_clean "after putting the manifest back"

# `--dry-run` must not even leave its scratch directory behind.
[ ! -e "$tree/.tmp" ] ||
    fail "$tree/.tmp exists: a dry run, or a refusal, wrote something into the tree"

say "the write mode moves exactly the files that carry the version"
run patch
expect_last "patch" "$want_patch"
expect_status "after patch" "$expected_bump"
for file in package.json package-lock.json src/browser/client-id.ts dist/app.js; do
    expect_named "the patch bump" "$file"
done
printf '%s\n' "$stdout"

grep -q "^  \"version\": \"$want_patch\",\$" "$tree/package.json" ||
    fail "package.json does not name $want_patch"
[ "$(grep -c "^ *\"version\": \"$want_patch\",\$" "$tree/package-lock.json")" = 2 ] ||
    fail "package-lock.json does not name $want_patch in exactly its own two fields"
grep -qE "^export const CLIENT_ID = \"web_client/$want_patch\";\$" "$tree/src/browser/client-id.ts" ||
    fail "src/browser/client-id.ts does not name web_client/$want_patch"
grep -qE "web_client/${want_patch//./\\.}([^0-9.]|\$)" "$tree/dist/app.js" ||
    fail "the bundle does not name web_client/$want_patch"

# The version's home in the runbook is asserted by the release workflow through this
# script, so a bump the manifest did not take is red there rather than at publish.
out="$("$tree/scripts/release-tags.sh" "v$want_patch")" ||
    fail "scripts/release-tags.sh refused v$want_patch after the bump: $out"
case "$out" in
    "version=$want_patch"*) ;;
    *) fail "scripts/release-tags.sh reported '$out'; want version=$want_patch" ;;
esac

say "the repository's own reproduction check passes on the bumped tree"
check_reproduces() {  # check_reproduces <label>
    rm -rf "$work/committed"
    cp -r "$tree/dist" "$work/committed"
    mkdir -p "$work/tmp"
    if ! (cd "$tree" && TMPDIR="$work/tmp" npm run build) > "$work/build.log" 2>&1; then
        cat "$work/build.log" >&2
        fail "$1: a build of the tree failed"
    fi
    TMPDIR="$work/tmp" "$tree/scripts/check-dist.sh" "$work/committed" "$tree/dist" ||
        fail "$1: a build does not reproduce the committed dist/"
    expect_status "$1" "$expected_bump"
}
check_reproduces "after the patch bump"

say "the run after it reads the manifest again, so the next patch is the one after that"
want_next="$cur_major.$cur_minor.$((10#$cur_patch + 2))"
run patch
expect_last "the second patch" "$want_next"
expect_status "after the second patch" "$expected_bump"
printf '%s\n' "$stdout"

say "a file that has fallen behind is repaired and named, in a run that says so"
# Two shapes of file behind the manifest: the identity the bundle is built from, and the
# bundle itself. Both must end at the new version, and both must be named.
sed -i "s|web_client/$want_next|web_client/$want_patch|" "$tree/src/browser/client-id.ts"
sed -i "s|web_client/$want_next|web_client/$want_patch|" "$tree/dist/app.js"
want_repair="$cur_major.$cur_minor.$((10#$cur_patch + 3))"
grep -qE "web_client/$want_patch([^0-9.]|\$)" "$tree/src/browser/client-id.ts" ||
    fail "the seed did not put the identity source behind, so this case proves nothing"
grep -qE "web_client/$want_patch([^0-9.]|\$)" "$tree/dist/app.js" ||
    fail "the seed did not put the bundle behind, so this case proves nothing"

run patch --dry-run
expect_last "the dry run over the files that are behind" "$want_repair"
grep -qE "web_client/$want_patch([^0-9.]|\$)" "$tree/src/browser/client-id.ts" ||
    fail "the dry run repaired a file it must not touch"

run patch
expect_last "the repair" "$want_repair"
expect_status "after the repair" "$expected_bump"
for file in src/browser/client-id.ts dist/app.js; do
    expect_named "the repair" "$file"
done
grep -qE "web_client/${want_repair//./\\.}([^0-9.]|\$)" "$tree/src/browser/client-id.ts" ||
    fail "the identity source was not repaired"
grep -qE "web_client/${want_repair//./\\.}([^0-9.]|\$)" "$tree/dist/app.js" ||
    fail "the bundle was not repaired"
check_reproduces "after the repair"

say "a run that fails once it has written leaves the tree as it found it"
# The failure is a build that cannot run at all: `npm run build` empties `dist/` and
# then reads this entry point, so a file that does not parse fails after the three
# writes and inside the rebuild — both halves of what the rollback covers.
cp "$tree/src/browser/main.ts" "$work/main.ts"
cp "$tree/dist/app.js" "$work/app.before-the-failure.js"
printf '\nthis is not a module\n' >> "$tree/src/browser/main.ts"
run patch
[ "$code" -ne 0 ] || fail "a tree whose entry point does not parse was accepted"
case "$stderr" in
    *"npm run build failed"*) ;;
    *) fail "the run did not fail in the build: $stderr" ;;
esac
# Each of the three files, and the bundle, is back at the version this case started from.
grep -q "^  \"version\": \"$want_repair\",\$" "$tree/package.json" ||
    fail "a failed run left package.json at the version it was moving to"
[ "$(grep -c "^ *\"version\": \"$want_repair\",\$" "$tree/package-lock.json")" = 2 ] ||
    fail "a failed run left package-lock.json at the version it was moving to"
grep -qE "web_client/${want_repair//./\\.}([^0-9.]|\$)" "$tree/src/browser/client-id.ts" ||
    fail "a failed run left the identity source at the version it was moving to"
cmp "$work/app.before-the-failure.js" "$tree/dist/app.js" ||
    fail "a failed run did not put the bundle back: it is not the bundle the tree started with"
expect_status "after a run that failed mid-build" "$expected_bump
 M src/browser/main.ts"

cp "$work/main.ts" "$tree/src/browser/main.ts"
expect_status "after putting the entry point back" "$expected_bump"
printf 'the tree is as it was, and the version files still name %s\n' "$want_repair"

say "nothing was committed and no tag was made or moved, on any of those runs"
[ "$(git -C "$tree" rev-parse HEAD)" = "$head_before" ] ||
    fail "a run moved HEAD; the caller commits, not this script"
[ "$(git -C "$tree" tag -l --format='%(refname:short) %(objectname)')" = "$tags_before" ] ||
    fail "a run created or moved a tag; the caller tags, and v0.5.1 is published and immutable"

printf '\nbump-version.sh: every property holds\n'
