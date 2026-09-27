#!/usr/bin/env bash
#
# Dispatch a workflow and wait for the run that dispatch created, so this script's exit status
# is that run's. `gh workflow run` prints no run id, so the run to wait on is the newest run of
# the workflow that is not the newest one seen before the dispatch: the run list is read on both
# sides of the dispatch, and the run is named with its id and URL before it is waited on.
#
#   scripts/dispatch-and-wait.sh --dispatch [--workflow <file>] [--ref <ref>] [-f <key>=<value>]... [--repo <owner/name>]
#   scripts/dispatch-and-wait.sh --run-id <run-id> [--workflow <file>] [--repo <owner/name>]
#   scripts/dispatch-and-wait.sh --watch-next [--workflow <file>] [--repo <owner/name>]
#
#   --dispatch    dispatch `--workflow` at `--ref` with the `-f` inputs, then wait for the run
#                 the dispatch creates; this is what a release step needs
#   --run-id      watch a run that already exists and dispatch nothing — how the wait is proved
#                 without cutting a release, with `--repo` naming a run outside this checkout
#   --watch-next  wait for the next run of `--workflow` without dispatching one
#
# All three take `--deadline-seconds`, `--appear-deadline-seconds` and `--poll-interval-seconds`.
#
# The completion deadline outlasts `deploy-prod.yml`'s own `timeout-minutes: 20` plus the queue
# ahead of it, so a deploy that hangs is reported by the deploy's own timeout rather than here.
# The appearance deadline is the read-after-write lag between `gh workflow run` and its run
# reaching `gh run list`, which is seconds; a dispatch this cannot see in minutes is a dispatch
# that did not happen. A deadline that passes reports the last read rather than looking hung.
#
# The three ways this fails are each named as itself: a run that never appeared, a run that did
# not finish inside the deadline, and a run that finished with a conclusion that is not
# `success`. In `--dispatch` mode each of them also says what remains: for the release, whose
# dispatch names `web_version`, the tag and the Release exist and the public demo did not take
# the release, so the deploy's own run is the next thing to read, with the `gh workflow run`
# that repeats the dispatch.
#
# `gh` is `$SELVAGE_GH` or `gh` on `PATH`; where it lives under Nix only, run this as
# `nix shell nixpkgs#gh -c scripts/dispatch-and-wait.sh ...`.
set -euo pipefail

gh="${SELVAGE_GH:-gh}"
default_workflow=deploy-prod.yml
default_ref=main
# `deploy-prod.yml`'s own job carries `timeout-minutes: 20`; the extra ten minutes are for the
# queue ahead of it, so a deploy that hangs is failed by the deploy's own timeout and not here.
default_deadline_seconds=1800
default_appear_deadline_seconds=300
default_poll_interval_seconds=10

workflow="$default_workflow"
ref="$default_ref"
repo=""
run_id=""
mode=""
before=""
found_row=""
deadline_seconds="$default_deadline_seconds"
appear_deadline_seconds="$default_appear_deadline_seconds"
poll_interval_seconds="$default_poll_interval_seconds"
inputs=()

usage() {
    cat >&2 <<EOF
usage: $0 --dispatch [--workflow <file>] [--ref <ref>] [-f <key>=<value>]... [--repo <owner/name>]
       $0 --run-id <run-id> [--workflow <file>] [--repo <owner/name>]
       $0 --watch-next [--workflow <file>] [--repo <owner/name>]

  --dispatch                 dispatch the workflow, then wait for the run it creates
  --run-id <run-id>          wait for a run that already exists; dispatch nothing
  --watch-next               wait for the next run of the workflow; dispatch nothing
  --workflow <file>          workflow file (default: $default_workflow)
  --ref <ref>                ref to dispatch (default: $default_ref)
  -f <key>=<value>           dispatch input, repeated as needed
  --repo <owner/name>        repository for gh to read (default: the checkout)
  --deadline-seconds <n>     bound on waiting for the run to finish (default: $default_deadline_seconds)
  --appear-deadline-seconds <n>
                             bound on waiting for a dispatched run to appear (default: $default_appear_deadline_seconds)
  --poll-interval-seconds <n>  seconds between reads (default: $default_poll_interval_seconds)
EOF
    exit 2
}

missing_value() {  # missing_value <option>
    printf 'dispatch-and-wait.sh: %s needs a value\n' "$1" >&2
    usage
}

require_seconds() {  # require_seconds <option> <value>
    case "$2" in
        '' | *[!0-9]*)
            printf 'dispatch-and-wait.sh: %s takes a whole number of seconds, not %s\n' "$1" "$2" >&2
            usage
            ;;
    esac
}

mode_count=0
while [ "$#" -gt 0 ]; do
    case "$1" in
        --dispatch)
            mode=dispatch
            mode_count=$((mode_count + 1))
            shift
            ;;
        --run-id)
            [ "$#" -ge 2 ] || missing_value "$1"
            run_id="$2"
            mode=run
            mode_count=$((mode_count + 1))
            shift 2
            ;;
        --watch-next)
            mode=next
            mode_count=$((mode_count + 1))
            shift
            ;;
        --workflow)
            [ "$#" -ge 2 ] || missing_value "$1"
            workflow="$2"
            shift 2
            ;;
        --ref)
            [ "$#" -ge 2 ] || missing_value "$1"
            ref="$2"
            shift 2
            ;;
        --repo)
            [ "$#" -ge 2 ] || missing_value "$1"
            repo="$2"
            shift 2
            ;;
        --deadline-seconds)
            [ "$#" -ge 2 ] || missing_value "$1"
            require_seconds "$1" "$2"
            deadline_seconds="$2"
            shift 2
            ;;
        --appear-deadline-seconds)
            [ "$#" -ge 2 ] || missing_value "$1"
            require_seconds "$1" "$2"
            appear_deadline_seconds="$2"
            shift 2
            ;;
        --poll-interval-seconds)
            [ "$#" -ge 2 ] || missing_value "$1"
            require_seconds "$1" "$2"
            poll_interval_seconds="$2"
            shift 2
            ;;
        -f)
            [ "$#" -ge 2 ] || missing_value "$1"
            inputs+=("$2")
            shift 2
            ;;
        -h | --help) usage ;;
        *)
            printf 'dispatch-and-wait.sh: unknown argument %s\n' "$1" >&2
            usage
            ;;
    esac
done

[ "$mode_count" -eq 1 ] || {
    printf 'dispatch-and-wait.sh: name exactly one of --dispatch, --run-id or --watch-next\n' >&2
    usage
}

# Every gh call goes through here, so `--repo` is written once.
gh_call() {
    if [ -n "$repo" ]; then
        "$gh" "$@" --repo "$repo"
    else
        "$gh" "$@"
    fi
}

row_field() {  # row_field <tsv-row> <n>
    printf '%s' "$1" | cut -f"$2"
}

newest_run_id() {  # the newest run of the workflow, or nothing when it has none
    gh_call run list --workflow "$workflow" --limit 1 --json databaseId \
        --jq '.[0].databaseId // empty'
}

newest_run_row() {  # the newest run of the workflow, or nothing when it has none
    gh_call run list --workflow "$workflow" --limit 1 \
        --json databaseId,status,conclusion,url \
        --jq '.[0] // empty | [.databaseId, .status, .conclusion, .url] | @tsv'
}

read_run_row() {  # read_run_row <run-id>
    gh_call run view "$1" --json databaseId,status,conclusion,url \
        --jq '[.databaseId, .status, .conclusion, .url] | @tsv'
}

input_value() {  # input_value <key>: the value of the KEY=VALUE input, or nothing
    local item
    for item in "${inputs[@]}"; do
        case "$item" in
            "$1"=*) printf '%s' "${item#*=}"; return 0 ;;
        esac
    done
}

report_conclusion() {  # report_conclusion <run-id> <conclusion> <url>
    printf 'run %s concluded %s:\n  %s\nRead its log with:\n  gh run view %s --log-failed%s\n' \
        "$1" "${2:-without a conclusion}" "$3" "$1" "${repo:+ --repo $repo}" >&2
}

report_never_appeared() {  # report_never_appeared <last-row>
    local saw id url
    if [ -z "$1" ]; then
        saw="no runs of $workflow are visible"
    else
        id="$(row_field "$1" 1)"
        url="$(row_field "$1" 4)"
        if [ "$id" = "$before" ]; then
            saw="the newest run is still $id ($url), the one that was already there"
        else
            saw="the newest run is $id ($url)"
        fi
    fi
    printf 'no run of %s appeared within %ss.\nThe last read: %s.\n' \
        "$workflow" "$appear_deadline_seconds" "$saw" >&2
}

report_did_not_finish() {  # report_did_not_finish <url> <status>
    printf 'the %s run did not finish within %ss:\n  %s\nThe last read said status=%s.\n' \
        "$workflow" "$deadline_seconds" "$1" "${2:-unknown}" >&2
}

# What a reader has left when a dispatch fails. A dispatch that named `web_version` is the
# release's own: the tag and the Release exist and the page image was published before this step
# ran, so only the demo is behind. Anything else dispatched here gets the generic line rather
# than a claim about a release it is not.
remains() {
    local version
    version="$(input_value web_version)"
    if [ -n "$version" ]; then
        printf 'What remains:\n  the release is already out — v%s is tagged, its Release is published and its page\n  image exists. The public demo did not take it, and this step cannot move it further.\n  The dispatch above is the button that moves the demo, and its run is the next thing to\n  read; re-dispatch it with:\n' "$version" >&2
    else
        printf 'What remains:\n  the dispatch above is the next thing to read; re-dispatch it with:\n' >&2
    fi
    printf '    gh workflow run %s --ref %s' "$workflow" "$ref" >&2
    local item
    for item in "${inputs[@]}"; do
        printf ' -f %s' "$item" >&2
    done
    printf '%s\n' "${repo:+ --repo $repo}" >&2
}

fail_here() {  # fail_here: print what remains when a release step is the caller
    if [ "$mode" = dispatch ]; then
        remains
    fi
    exit 1
}

# The newest run that is not the one seen before; its row lands in found_row.
wait_for_next_run() {
    local started=$SECONDS row last=""
    while :; do
        if ! row="$(newest_run_row)"; then
            printf 'dispatch-and-wait.sh: lost contact with gh while reading %s runs\n' "$workflow" >&2
            exit 1
        fi
        if [ -n "$row" ] && [ "$(row_field "$row" 1)" != "$before" ]; then
            found_row="$row"
            return 0
        fi
        last="$row"
        if [ "$((SECONDS - started))" -ge "$appear_deadline_seconds" ]; then
            report_never_appeared "$last"
            fail_here
        fi
        sleep "$poll_interval_seconds"
    done
}

# Poll one run until it completes, naming the last read if the deadline passes first.
wait_for_conclusion() {  # wait_for_conclusion <run-id>
    local run="$1" started=$SECONDS row status conclusion url
    while :; do
        if ! row="$(read_run_row "$run")"; then
            printf 'dispatch-and-wait.sh: lost contact with gh while watching run %s\n' "$run" >&2
            exit 1
        fi
        status="$(row_field "$row" 2)"
        conclusion="$(row_field "$row" 3)"
        url="$(row_field "$row" 4)"
        if [ "$status" = completed ]; then
            if [ "$conclusion" = success ]; then
                printf '%s run %s concluded success: %s\n' "$workflow" "$run" "$url"
                exit 0
            fi
            report_conclusion "$run" "$conclusion" "$url"
            fail_here
        fi
        if [ "$((SECONDS - started))" -ge "$deadline_seconds" ]; then
            report_did_not_finish "$url" "$status"
            fail_here
        fi
        sleep "$poll_interval_seconds"
    done
}

watch_named_run() {  # watch_named_run <run-id>
    local row url
    if ! row="$(read_run_row "$1")"; then
        printf 'dispatch-and-wait.sh: cannot read run %s\n' "$1" >&2
        exit 1
    fi
    url="$(row_field "$row" 4)"
    printf 'watching run %s: %s\n' "$1" "$url"
    wait_for_conclusion "$1"
}

if [ "$mode" = run ]; then
    watch_named_run "$run_id"
fi

if ! before="$(newest_run_id)"; then
    printf 'dispatch-and-wait.sh: cannot read %s runs\n' "$workflow" >&2
    exit 1
fi

if [ "$mode" = dispatch ]; then
    dispatch_argv=(workflow run "$workflow" --ref "$ref")
    for item in "${inputs[@]}"; do
        dispatch_argv+=(-f "$item")
    done
    if ! gh_call "${dispatch_argv[@]}"; then
        printf 'dispatch-and-wait.sh: could not dispatch %s at %s\n' "$workflow" "$ref" >&2
        exit 1
    fi
fi

wait_for_next_run
run="$(row_field "$found_row" 1)"
printf 'watching run %s: %s\n' "$run" "$(row_field "$found_row" 4)"
wait_for_conclusion "$run"
