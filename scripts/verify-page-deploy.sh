#!/usr/bin/env bash
#
# What a page deploy can be verified by, and which of the reads decides the run.
#
#   scripts/verify-page-deploy.sh --web-version <tag> [--ssh-target <user@host>]
#
# A dispatch that names only `SELVAGE_WEB_IMAGE` is verified weakly on purpose, and the
# three reads it can support are printed here under the names of their weight — `strong`,
# `weak`, `report` — so that what came back is never mistaken for what it means.
#
#   strong   `ghcr.io`'s own digest for `ghcr.io/selvage-protocol/selvage-web:<tag>`, and
#            the digest `latest` names, and whether the two agree. **This is the read that
#            decides the run**: the tag the deploy pinned must name bytes the registry
#            really holds, so a digest that cannot be read fails the step. Disagreement
#            with `latest` is *reported and not failed*: pinning an older release is a
#            supported dispatch, and `latest` then names the newer one.
#   weak     the demo's page, read on the box through the front. It answers 200 or it does
#            not, and it is polled to a deadline because a deploy has just recreated the
#            container. It **cannot say which page build is served**: `dist/index.html`
#            carries no version, the only version-shaped string in the page lives in the
#            bundle and is the same on every build, and the delivered HTML is rewritten on
#            the way out (Cloudflare Rocket Loader, and the front's own `sub_filter`
#            injecting the terms notice), so no byte comparison through that edge proves
#            anything. `200` is the whole of what this read can support, and a page that
#            stops answering is an origin fact, so it fails the run. Skipped, with that
#            said in words, when no `--ssh-target` is given.
#   report   the public URL, read from this runner. Cloudflare serves a managed challenge to
#            a programmatic client on a datacenter address and an edge is not something a
#            deploy can fix, so a challenge is named in words and ends the attempt at the
#            first one instead of polling a deadline it cannot pass. **Nothing here fails
#            the run**: this read reports, and the two above are the checks.
#
# Nothing from the dispatch reaches the remote shell: the SSH command is this script's own
# constant, and the version is compared on this side.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
image=ghcr.io/selvage-protocol/selvage-web
# The name the deployment's front is the server for, and the one it answers; a request
# naming any other Host is closed rather than served. `docs/runbook-prod-demo.md` owns it.
demo_host=selvage-demo.dontblameme.dev
ssh_connect_timeout_seconds=10
curl_max_seconds=15
origin_deadline_seconds=60
poll_interval_seconds=5

web_version=""
ssh_target=""

usage() {
    printf 'usage: %s --web-version <tag> [--ssh-target <user@host>]\n' "$0" >&2
    exit 2
}

strong() { printf 'strong: %s\n' "$*"; }
weak() { printf 'weak:   %s\n' "$*"; }
report() { printf 'report: %s\n' "$*"; }

fail() {  # fail <message>
    printf 'verify-page-deploy.sh: %s\n' "$1" >&2
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '::error::verify-page-deploy.sh: %s\n' "$1" >&2
    fi
    exit 1
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --web-version | --ssh-target)
            [ "$#" -ge 2 ] || {
                printf 'verify-page-deploy.sh: %s needs a value\n' "$1" >&2
                usage
            }
            case "$1" in
                --web-version) web_version="$2" ;;
                --ssh-target) ssh_target="$2" ;;
            esac
            shift 2
            ;;
        *) printf 'verify-page-deploy.sh: unknown argument %s\n' "$1" >&2 && usage ;;
    esac
done

[ -n "$web_version" ] || {
    printf 'verify-page-deploy.sh: --web-version is required\n' >&2
    usage
}

# ---- the strong read: the registry's own digest ------------------------------------------

digest=""
if ! digest="$("$script_dir/page-image.sh" digest "$web_version" 2>&1)"; then
    fail "the registry did not answer with a digest for $image:$web_version ($digest), so what this deploy pinned cannot be read back"
fi
strong "$image:$web_version is $digest"

latest_digest=""
if ! latest_digest="$("$script_dir/page-image.sh" digest latest 2>&1)"; then
    latest_digest=""
    strong "and $image:latest could not be read ($latest_digest), so the two are not compared"
elif [ "$web_version" = latest ]; then
    strong "web_version is latest, so the two reads above are the same tag and agree by construction"
elif [ "$digest" = "$latest_digest" ]; then
    strong "and $image:latest is the same digest, so the moving tag names this release"
else
    strong "and $image:latest is $latest_digest, which is a different digest: expected when a pin names an older release, and not a failure of this deploy"
fi

# ---- the weak read: the demo's page, on the box, through the front -----------------------

page_status() {
    ssh -o BatchMode=yes -o "ConnectTimeout=$ssh_connect_timeout_seconds" \
        -o StrictHostKeyChecking=accept-new "$ssh_target" \
        "curl -sk -o /dev/null -w '%{http_code}' --max-time $curl_max_seconds -H 'Host: $demo_host' https://127.0.0.1/" \
        2>&1
}

weak_summary="the demo's page was not read (no --ssh-target was given)"
if [ -z "$ssh_target" ]; then
    weak "not read: no --ssh-target was given, and this read is the box's own front"
else
    started=$SECONDS
    last=""
    while :; do
        if last="$(page_status)" && [ "$last" = 200 ]; then
            weak "the demo's page answered 200 on the origin (best effort: it cannot say which page build is served)"
            weak_summary="the demo's page answered 200"
            break
        fi
        if [ "$((SECONDS - started))" -ge "$origin_deadline_seconds" ]; then
            fail "the demo's page did not answer 200 within ${origin_deadline_seconds}s; last read: ${last:-nothing}"
        fi
        sleep "$poll_interval_seconds"
    done
fi

# ---- the report: the public URL ---------------------------------------------------------

public_url="https://$demo_host/"
public_response=""
if ! public_response="$(curl -sS --max-time "$curl_max_seconds" -D - "$public_url" 2>&1)"; then
    report "the public read of $public_url could not be made at all ($public_response); expected on a datacenter address"
else
    # The headers are the first block of the response, up to the blank line before the body.
    # The body is read to the end rather than left unread: a reader that exits early gives
    # the writer a `SIGPIPE`, and with `pipefail` that is the step's exit status.
    public_headers="$(printf '%s\n' "$public_response" | awk 'BEGIN { RS = "" } NR == 1 { print }')"
    public_status="$(printf '%s\n' "$public_headers" | tr -d '\r' |
        sed -n 's|^HTTP/[0-9.]* \([0-9][0-9][0-9]\).*|\1|p' | sed -n '1p')"
    public_mitigated="$(printf '%s\n' "$public_headers" | tr -d '\r' |
        sed -n 's/^[Cc]f-[Mm]itigated:[[:space:]]*//p' | sed -n '1p')"
    # The header is the reliable half of the observation; an interstitial's own words are
    # the belt to its braces. `cdn-cgi/challenge-platform` is deliberately not one of them:
    # Cloudflare's JS detection injects a script under that path into ordinary pages — it is
    # in the demo's own 200 today — so matching it would report a healthy read as a
    # challenge and teach the reader to distrust the word.
    public_lowered="$(printf '%s\n' "$public_response" | tr '[:upper:]' '[:lower:]')"
    public_marker=""
    for marker in 'just a moment' 'attention required! | cloudflare'; do
        case "$public_lowered" in
            *"$marker"*)
                public_marker="$marker"
                break
                ;;
        esac
    done
    if [ -n "$public_mitigated" ]; then
        report "the public read is a challenge: ${public_status:-no status} with cf-mitigated: $public_mitigated. The edge is not something a deploy can fix, and a challenge ends this attempt rather than being polled at — the origin above is the read that was checked."
    elif [ "$public_status" = 200 ]; then
        report "the public page answered 200. It cannot say which page build is served either, so it is reported and nothing here depends on it."
    elif [ -n "$public_marker" ]; then
        report "the public read is a challenge: ${public_status:-no status} carrying a Cloudflare interstitial body ($public_marker). Same as above: reported, not failed, and not polled at."
    else
        report "the public read answered ${public_status:-nothing}, which is neither a challenge nor a 200. Reported, not failed: the edge is not this deploy's to change."
    fi
fi

printf 'verify-page-deploy.sh: green — the registry holds %s:%s, and %s; the public read above is a report\n' \
    "$image" "$web_version" "$weak_summary"
