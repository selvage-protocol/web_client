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
#   - nested refs returned by Git's tail-pattern matching never stand in for exact
#     current or target tags, including mixed refs and annotated tags;
#   - a target tag that is already on the remote is refused, naming it;
#   - after a successful plan, the release job's pre-bump shell rechecks both remote
#     tags, refuses query errors and a changed planned version, and accepts unchanged
#     state or a neighbouring target tag; workflow ordering and normal CI wiring are pinned;
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

mkdir -p "$repo_root/.tmp"
work="$(mktemp -d "$repo_root/.tmp/release-plan-test.XXXXXX")"

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
tag_remote() {
    git -C "$origin" -c tag.gpgsign=false \
        -c user.name=DontBlameMe -c user.email=dontblameme@noreply.codeberg.org tag "$@"
}

# `stdout` and `stderr` are kept apart: the plan's stdout is what a workflow appends to
# `$GITHUB_OUTPUT`, so a stray line there is a defect however useful it looks.
stdout=""
stderr=""
code=0
run() {  # run <args...>
    stdout="$(
        cd "$tree"
        if [ "${release_attempt:-false}" = true ]; then
            BUMP="${1:-}" VERSION="$planned_version" bash "$preflight"
        else
            scripts/release-plan.sh "$@"
        fi 2> "$work/stderr"
    )" && code=0 || code=$?
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
    [ -z "$stdout" ] || fail "$label: refusal printed plan output: $stdout"
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

create_fixture() {  # create_fixture <empty-directory>
    work="$1"
    origin="$work/origin.git"
    tree="$work/tree"
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
}

say "every release attempt revalidates the planned version before the first mutation"
preflight="$work/release-preflight.sh"
node --input-type=module - "$preflight" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
const release = workflow.split('\n  release:\n')[1];
assert.ok(release, 'release job exists');
const safe = release.indexOf('run: git config --global --add safe.directory');
const step = release.indexOf('- name: bump the version, and rebuild the bundle the commit carries');
assert.ok(safe >= 0 && safe < step, 'safe-directory setup precedes the bump step');
const bumpStep = release.slice(step).split('\n      - name:')[0];
assert.ok(bumpStep.includes('VERSION: ${{ needs.plan.outputs.version }}'), 'compare with the original plan output');
assert.ok(bumpStep.includes('BUMP: ${{ inputs.bump }}'), 'recompute the dispatched bump');
const body = bumpStep.split('        run: |\n')[1].split('\n')
    .filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
const guard = body.indexOf('plan="$(scripts/release-plan.sh "$BUMP")"');
const comparison = body.indexOf('if [ "$planned" != "$VERSION" ]; then');
const bump = body.indexOf('scripts/bump-version.sh "$BUMP"');
assert.ok(guard >= 0 && guard < comparison && comparison < bump,
    'release retry guard and planned-version comparison precede the first bump');
assert.ok(body.slice(guard, comparison).includes("planned=\"$(printf '%s\\n' \"$plan\" | sed -n 's/^version=//p')\""),
    'compare the recomputed version, not a cached value');
assert.match(body.slice(comparison, bump), /exit 1\nfi/, 'a changed plan fails before bumping');
assert.ok(step < release.indexOf('commit -a -m') && step < release.indexOf('git push origin HEAD:main'),
    'revalidation precedes commit and push');
for (const file of ['.github/workflows/ci.yml', 'scripts/ci-local.sh']) {
    assert.ok(readFileSync(file, 'utf8').includes('scripts/test-release-plan.sh'), `${file} runs this regression`);
}
writeFileSync(process.argv[2], `${body.slice(0, bump)}\n`);
NODE

say "a throwaway remote and a clone, so this checkout's own tags are not reachable"
create_fixture "$work"

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
(
    work="$(mktemp -d "$work/prefix-only.XXXXXX")"
    create_fixture "$work"
    tag_remote "v$neighbour" main
    expect_remote "v$neighbour"
    baseline
    run patch
    expect_refusal "only v$neighbour is on the remote" 1 "v$current"
    expect_untouched "after refusing a prefix-only match"
)

say "Git tail-pattern matches are not exact tag identities"
for state in nested-current-only nested-target-only mixed-current mixed-target annotated-current annotated-target; do
    (
        create_fixture "$(mktemp -d "$work/$state.XXXXXX")"
        case "$state" in
            nested-current-only) tag_remote "refs/tags/v$current" main ;;
            annotated-current) tag_remote -a "v$current" -m "current release" main ;;
            *) tag_remote "v$current" main ;;
        esac
        case "$state" in
            nested-target-only) tag_remote "refs/tags/v$want_patch" main ;;
            mixed-current)
                tag_remote "refs/tags/v$current" main
                tag_remote "refs/tags/v$want_patch" main
                ;;
            mixed-target)
                tag_remote "refs/tags/v$want_patch" main
                tag_remote "v$want_patch" main
                ;;
            annotated-target) tag_remote -a "v$want_patch" -m "target release" main ;;
        esac
        if [ "$state" = nested-current-only ]; then
            # Prove the surprising Git behavior with the real remote, not a query stub.
            matches="$(git ls-remote --exit-code --refs --tags "$origin" "refs/tags/v$current")"
            [ "$matches" = "$(printf '%s\t%s' "$base_commit" "refs/tags/refs/tags/v$current")" ] ||
                fail "Git did not return the nested-current alias: $matches"
            printf 'real Git tail match: %s\n' "$matches"
        fi
        baseline
        run patch
        case "$state" in
            nested-current-only) expect_refusal "$state" 1 "carries no tag v$current" ;;
            mixed-target | annotated-target) expect_refusal "$state" 1 "tag v$want_patch already exists" ;;
            *) expect_plan "$state" "$current" "$want_patch" ;;
        esac
        expect_untouched "after $state"
    )
done

say "a target tag that is already on the remote is refused"
(
    work="$(mktemp -d "$work/target-conflict.XXXXXX")"
    create_fixture "$work"
    tag_remote "v$current" main
    tag_remote "v$want_patch" main
    expect_remote "v$current" "v$want_patch"
    baseline
    run patch
    expect_refusal "target v$want_patch already exists" 1 "v$want_patch"
    expect_untouched "after refusing an existing target tag"
)

say "a release-only retry rechecks remote state after a successful plan"
for changed in target current nested-current nested-target mixed-target annotated-current annotated-target remote target-remote mismatch neighbour unchanged; do
    (
        create_fixture "$(mktemp -d "$work/retry-$changed.XXXXXX")"
        tag_remote "v$current" main
        baseline
        run patch
        expect_plan "before retry: $changed" "$current" "$want_patch"
        planned_version="$want_patch"
        expect_untouched "after the successful plan: $changed"
        case "$changed" in
            target) tag_remote "v$want_patch" main ;;
            nested-target) tag_remote "refs/tags/v$want_patch" main ;;
            mixed-target)
                tag_remote "refs/tags/v$want_patch" main
                tag_remote "v$want_patch" main
                ;;
            annotated-target) tag_remote -a "v$want_patch" -m "target release" main ;;
            neighbour) tag_remote "v${want_patch}0" main ;;
            current | nested-current | annotated-current)
                # Switch to an independently seeded remote for the new current-tag state.
                origin="$work/current-missing.git"
                git init --bare --quiet --initial-branch=main "$origin"
                git -C "$origin" config receive.shallowUpdate true
                git -C "$tree" remote set-url origin "$origin"
                git -C "$tree" push --quiet origin HEAD:refs/heads/main
                case "$changed" in
                    current) tag_remote "v$neighbour" main ;;
                    nested-current) tag_remote "refs/tags/v$current" main ;;
                    annotated-current) tag_remote -a "v$current" -m "current release" main ;;
                esac
                ;;
            remote) git -C "$tree" remote set-url origin "$work/unreachable.git" ;;
            target-remote)
                # Let the current query succeed, then make real Git fail on the target read.
                export REAL_GIT="$(command -v git)" FAIL_REF="refs/tags/v$want_patch"
                export UNREACHABLE="$work/unreachable.git"
                mkdir "$work/bin"
                printf '#!%s\n' "$(command -v bash)" > "$work/bin/git"
                cat >> "$work/bin/git" <<'SH'
if [ "$1" = ls-remote ] && [ "${!#}" = "$FAIL_REF" ]; then
    exec "$REAL_GIT" ls-remote "$UNREACHABLE"
fi
exec "$REAL_GIT" "$@"
SH
                chmod +x "$work/bin/git"
                export PATH="$work/bin:$PATH"
                run patch
                expect_refusal "plan: target query failed" 1 "git ls-remote exited 128"
                [[ "$stderr" = *"$UNREACHABLE"* ]] || fail "lost Git's target-read error: $stderr"
                ;;
            mismatch) planned_version="$want_minor" ;;
        esac
        baseline
        release_attempt=true
        run patch
        case "$changed" in
            target | mixed-target | annotated-target) expect_refusal "retry: $changed appeared" 1 "v$want_patch" ;;
            current | nested-current) expect_refusal "retry: $changed exact current disappeared" 1 "carries no tag v$current" ;;
            remote) expect_refusal "retry: remote query failed" 1 "could not read the tags" ;;
            target-remote)
                expect_refusal "retry: target query failed" 1 "git ls-remote exited 128"
                [[ "$stderr" = *"$UNREACHABLE"* ]] || fail "lost Git's retry target-read error: $stderr"
                ;;
            mismatch) expect_refusal "retry: planned version changed" 1 "$planned_version" ;;
            neighbour | unchanged | nested-target | annotated-current)
                [ "$code" -eq 0 ] || fail "retry: $changed plan refused: $stderr"
                printf 'accepted retry: %s plan\n' "$changed"
                ;;
        esac
        expect_untouched "after retry: $changed"
    )
done

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
