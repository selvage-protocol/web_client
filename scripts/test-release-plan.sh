#!/usr/bin/env bash
#
# Covers `scripts/release-plan.sh`. Everything runs in a throwaway remote and a clone of
# it under `.tmp/`, so nothing here can read — let alone move — this checkout's own tags.
#
#   scripts/test-release-plan.sh
#
# What is asserted:
#
#   - the plan is the next version of the three a bump word asks for, and it prints
#     exactly the three `$GITHUB_OUTPUT` lines a release workflow appends;
#   - the invariant that makes a second click safe: a manifest naming a version the remote
#     has no tag for is refused, which is the state a bump leaves behind when its tag was
#     never created. A *neighbouring* tag does not satisfy it — `v0.5.10` beside `v0.5.1`
#     is a different ref, and a guard that matched a prefix would release the wrong one;
#   - a target tag that is already on the remote is refused, naming it;
#   - the bump word's grammar is `bump-version.sh`'s: nothing at all, a version, a
#     misspelling, `--dry-run`, a second argument and a third are refused with exit 2 and
#     a message naming what was refused;
#   - a manifest that is not MAJOR.MINOR.PATCH is refused, naming it;
#   - a remote that cannot be read at all is refused *as that*, with git's own words,
#     rather than reported as a tag that is not there — the two are different states and
#     only one of them is a reason not to release;
#   - the plan writes nothing anywhere: no file in the tree, no local tag, no ref on the
#     remote, in every case above.
#
# No version is written down here: the numbers are read from the manifest the way the
# script reads them, so this test does not have to change when the version does. The
# remote it starts from is built here rather than inherited, because a CI checkout is
# shallow and carries no tags at all — a test that assumed this checkout's tags would pass
# in a checkout and fail on a runner.
#
# `scripts/ci-local.sh checks` runs this.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

work="$repo_root/.tmp/release-plan-test"
origin="$work/origin.git"
tree="$work/tree"

say() { printf '\n=== %s ===\n' "$*"; }
fail() {
    printf '%s\n' "$*" >&2
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '%s\n' "::error::$*"
    fi
    exit 1
}

manifest_version() { sed -n 's/^  "version": "\(.*\)",$/\1/p' "$1/package.json" | head -n 1; }
seed_manifest() { sed -i "s/^  \"version\": \".*\",\$/  \"version\": \"$1\",/" "$tree/package.json"; }

remote_tags() { git -C "$origin" tag -l | sort; }
local_tags() { git -C "$tree" tag -l | sort; }

# Every tag here is made in the throwaway remote, and with signing off by hand: a global
# `tag.gpgsign` would turn a lightweight tag into a signed one that wants a message, which
# is an editor. Nothing in this test depends on the ambient git configuration.
tag_remote() { git -C "$origin" -c tag.gpgsign=false tag "$@"; }
untag_remote() { git -C "$origin" -c tag.gpgsign=false tag -d "$@" > /dev/null; }

# `stdout` and `stderr` are kept apart: the plan's stdout is what a workflow appends to
# `$GITHUB_OUTPUT`, so a stray line there is a defect however useful it looks.
stdout=""
stderr=""
code=0
run() {  # run <args...>
    stdout="$("$tree/scripts/release-plan.sh" "$@" 2> "$work/stderr")" && code=0 || code=$?
    stderr="$(cat "$work/stderr")"
}

expect_plan() {  # expect_plan <label> <current> <version>
    local want
    [ "$code" -eq 0 ] || fail "$1: exit status $code, and it said on stderr:
$stderr"
    want="$(printf 'current=%s\nversion=%s\ntag=v%s' "$2" "$3" "$3")"
    if [ "$stdout" != "$want" ]; then
        fail "$1: stdout is
${stdout:-nothing}
want exactly
$want"
    fi
    printf 'planned  %-46s %s -> %s\n' "$1" "$2" "$3"
}

expect_refusal() {  # expect_refusal <label> <exit-wanted> <must-name|->
    local label="$1" want="$2" must="$3"
    [ "$code" -eq "$want" ] || fail "$label: exited $code, want $want; stderr was:
$stderr"
    [ -n "$stderr" ] || fail "$label: refused with no message"
    if [ "$must" != "-" ]; then
        case "$stderr" in
            *"$must"*) ;;
            *) fail "$label: the refusal does not name '$must': $stderr" ;;
        esac
    fi
    printf 'refused  %-46s exit %s: %s\n' "$label" "$code" "$(printf '%s' "$stderr" | head -n 1)"
}

# Nothing the plan does may reach either tag list. A case that changes the remote on
# purpose takes a fresh baseline after doing it, so these stay a check on the plan rather
# than on the case's own setup.
tags_before=""
local_tags_before=""
baseline() {
    tags_before="$(remote_tags)"
    local_tags_before="$(local_tags)"
}
expect_remote_unchanged() {  # expect_remote_unchanged <label>
    local have
    have="$(remote_tags)"
    [ "$have" = "$tags_before" ] || fail "$1: the remote's tags changed:
$have"
}
expect_untouched() {  # expect_untouched <label>: the tree, its tags and the remote
    local have
    have="$(git -C "$tree" status --porcelain -uall)"
    [ -z "$have" ] || fail "$1: the tree changed:
$have"
    have="$(local_tags)"
    [ "$have" = "$local_tags_before" ] || fail "$1: the clone's tags changed:
$have"
    expect_remote_unchanged "$1"
}
expect_manifest() {  # expect_manifest <label> <version>
    local have
    have="$(manifest_version "$tree")"
    [ "$have" = "$2" ] || fail "$1: the manifest names '$have', want '$2'"
}

say "a throwaway remote and a clone, so this checkout's own tags are not reachable"
rm -rf "$work"
mkdir -p "$work"
# `--no-tags`: the clone starts with no local tags at all, so the tag list below is a
# check on the plan rather than on what the clone happened to carry.
git clone --quiet --no-hardlinks --no-tags "$repo_root" "$tree" ||
    fail "could not clone $repo_root into $tree"
git init --bare --quiet --initial-branch=main "$origin" ||
    fail "could not create the throwaway remote at $origin"
# A CI checkout is shallow, and a shallow history is refused by a repository that is not
# (`receive.shallowUpdate`, off by default). The remote is built from the checkout rather
# than inherited from it, so a full checkout and a shallow one start from the same state.
git -C "$origin" config receive.shallowUpdate true
git -C "$tree" remote set-url origin "$origin"
git -C "$tree" push --quiet origin "HEAD:refs/heads/main" ||
    fail "could not push the clone's commit to $origin"
# The commit the remote was given, before the script under test is committed on top of it
# below: a tag made on the clone's later commit would name an object the remote never got.
base_commit="$(git -C "$tree" rev-parse HEAD)"
[ "$(git -C "$tree" remote get-url origin)" = "$origin" ] ||
    fail "the clone's origin is not the throwaway remote, which is the whole point of it"

# The script under test is the working tree's, and a clone carries commits: until this
# change lands, the script is not one. Committing it into the clone is what makes every
# `git status` below the plan's doing and nothing else. Only the script is taken from the
# working tree.
cp "$repo_root/scripts/release-plan.sh" "$tree/scripts/release-plan.sh"
git -C "$tree" add -- scripts/release-plan.sh
if ! git -C "$tree" diff --cached --quiet; then
    GIT_EDITOR=true git -C "$tree" -c commit.gpgsign=false \
        -c user.name=DontBlameMe -c user.email=dontblameme@noreply.codeberg.org \
        commit --quiet -m "the script under test" ||
        fail "could not commit the script under test into the clone"
fi

current="$(manifest_version "$tree")"
[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] ||
    fail "the clone's package.json names '$current', which is not a version this test can bump"
cur_major="${BASH_REMATCH[1]}"
cur_minor="${BASH_REMATCH[2]}"
cur_patch="${BASH_REMATCH[3]}"
want_patch="$cur_major.$cur_minor.$((10#$cur_patch + 1))"
want_minor="$cur_major.$((10#$cur_minor + 1)).0"
want_major="$((10#$cur_major + 1)).0.0"
# The next patch's *neighbour*: one digit appended, so it shares a prefix with it.
neighbour="${current}0"

# The state a click is dispatched from: the version the manifest names has just been
# released. The tag is made here rather than fetched, so a shallow checkout and a full one
# start this test from the same remote — and it is made on the clone's own commit, which
# is the one the remote was given above.
tag_remote "v$current" "$base_commit" ||
    fail "could not tag $current on the throwaway remote"
expect_remote() {  # expect_remote <tag>...: the remote carries exactly these tags, sorted
    local want have
    want="$(printf '%s\n' "$@" | sort)"
    have="$(remote_tags)"
    [ "$have" = "$want" ] || fail "the remote carries
$have
want exactly
$want"
}

printf 'the clone is at %s; the remote carries just v%s\n' "$current" "$current"

say "the plan is the next version, and prints the three lines a workflow appends"
baseline
run patch
expect_plan "patch" "$current" "$want_patch"
expect_untouched "after planning a patch"
run minor
expect_plan "minor" "$current" "$want_minor"
expect_untouched "after planning a minor"
run major
expect_plan "major" "$current" "$want_major"
expect_untouched "after planning a major"

say "a manifest version with no tag on the remote is refused"
# The state a bump whose tag never landed leaves behind: the manifest has moved to the next
# version and the remote has no tag for it. A second click must refuse rather than compute
# the version after *that*.
seed_manifest "$want_patch"
baseline
run patch
expect_refusal "manifest $want_patch, remote has no v$want_patch" 1 "v$want_patch"
expect_remote_unchanged "after refusing an untagged manifest version"
expect_manifest "after refusing an untagged manifest version" "$want_patch"
seed_manifest "$current"
expect_manifest "after putting the manifest back" "$current"
expect_untouched "after putting the manifest back"

say "a neighbouring tag is not the tag: v$neighbour does not stand in for v$current"
tag_remote "v$neighbour" main
untag_remote "v$current"
expect_remote "v$neighbour"
baseline
run patch
expect_refusal "only v$neighbour is on the remote" 1 "v$current"
expect_untouched "after refusing a prefix-only match"
untag_remote "v$neighbour"
tag_remote "v$current" main
baseline

say "a target tag that is already on the remote is refused"
tag_remote "v$want_patch" main
expect_remote "v$current" "v$want_patch"
baseline
run patch
expect_refusal "target v$want_patch already exists" 1 "v$want_patch"
expect_untouched "after refusing an existing target tag"
untag_remote "v$want_patch"
baseline

say "the bump word's grammar is bump-version.sh's, and it exits 2"
for bad in "" "$current" "v$current" "PATCH" "latest" "--dry-run" "1.2.3.4"; do
    run "$bad"
    if [ -z "$bad" ]; then
        expect_refusal "bump ''" 2 "-"
    else
        expect_refusal "bump '$bad'" 2 "$bad"
    fi
    expect_untouched "after refusing the bump word '$bad'"
done
run
expect_refusal "no bump word at all" 2 "-"
expect_untouched "after refusing no bump word"
run patch extra
expect_refusal "a second argument" 2 "extra"
expect_untouched "after refusing a second argument"
run patch --dry-run extra
expect_refusal "three arguments" 2 "extra"
expect_untouched "after refusing three arguments"

say "a manifest that is not MAJOR.MINOR.PATCH is refused, naming it"
seed_manifest "not-a-version"
baseline
run patch
expect_refusal "manifest not-a-version" 1 "not-a-version"
expect_remote_unchanged "after refusing a malformed manifest"
expect_manifest "after refusing a malformed manifest" "not-a-version"
seed_manifest "$current"
expect_manifest "after putting the manifest back again" "$current"
expect_untouched "after putting the manifest back again"

say "a remote that cannot be read is refused as that, not as a tag that is not there"
git -C "$tree" remote set-url origin "$work/there-is-no-remote.git"
run patch
expect_refusal "unreachable remote" 1 "could not read the tags"
git -C "$tree" remote set-url origin "$origin"
baseline
expect_untouched "after restoring the remote"

say "the base state was left as it was found"
expect_remote "v$current"
run patch
expect_plan "patch, once more" "$current" "$want_patch"
expect_untouched "at the end"

printf '\nrelease-plan.sh: every case above behaved as asserted\n'
