#!/usr/bin/env bash
#
# The anonymous reads of this repository's published page image, in the one place three
# callers need them: the release workflow waits on the tag it has just dispatched, this
# repository's deploy refuses a name that is not published, and the deploy's verification
# compares the digest a tag names with the one `latest` names.
#
#   scripts/page-image.sh tags            the image's tags, one per line
#   scripts/page-image.sh digest <tag>    `ghcr.io`'s own digest for that tag
#
# No credential is used and none is needed: the package is public, so a pull token from
# the registry's own anonymous endpoint is the whole of the auth, which is the call
# `docs/runbook-release.md` §6 gives for exactly this check.
#
# The token and the tag list are read out of the JSON with `grep` and `sed` rather than a
# JSON parser, because the two places this runs carry different ones — the release job is a
# node container, the deploy job a runner with python and no node. The shapes read here are
# one field and one flat array of tags, and a tag cannot carry `[`, `]`, `"` or `,` (the OCI
# tag grammar), so nothing in them can be mistaken for structure. A body that is not read
# the way this expects cannot pass for one: an empty or unexpected list makes the callers
# refuse a tag rather than pin it, which is the safe direction.
#
# The tag list is read in one page. `ghcr.io` returns this image's tags without a `Link`
# header today; if it ever paginated, these reads would see fewer tags than exist, and both
# callers fail loudly on a tag they cannot find rather than pinning a name that is not there.
#
# The digest is the response's own `Docker-Content-Digest` and is never computed here: it is
# the registry's answer about the bytes it holds for that tag, which is what a deploy's
# verification has to compare. Both index media types are accepted, so a multi-architecture
# tag answers with the index's digest rather than being refused as an unexpected type.
#
# Every call is bounded: a `curl` with no answer would hang a release rather than fail it,
# and nothing here is written to disk — `/tmp` is RAM-backed on some hosts.
set -euo pipefail

registry=https://ghcr.io
repository=selvage-protocol/selvage-web
curl_max_seconds=20

usage() {
    printf 'usage: %s <tags|digest <tag>>\n' "$0" >&2
    exit 2
}

pull_token() {  # the pull token, or a message on stderr and a non-zero return
    local body token
    body="$(curl -fsS --max-time "$curl_max_seconds" \
        "$registry/token?scope=repository:$repository:pull&service=ghcr.io")" || {
        printf 'page-image.sh: %s did not answer with an anonymous pull token\n' "$registry" >&2
        return 1
    }
    token="$(printf '%s' "$body" | grep -o '"token":"[^"]*"' | head -n 1 | cut -d '"' -f 4)"
    [ -n "$token" ] || {
        printf 'page-image.sh: %s answered with no token field\n' "$registry" >&2
        return 1
    }
    printf '%s' "$token"
}

read_tags() {
    local token body
    token="$(pull_token)" || return 1
    body="$(curl -fsS --max-time "$curl_max_seconds" -H "Authorization: Bearer $token" \
        "$registry/v2/$repository/tags/list")" || {
        printf 'page-image.sh: could not read the tags of %s/%s\n' "$registry" "$repository" >&2
        return 1
    }
    # Flattened first, so a body this service may one day pretty-print reads the same.
    printf '%s' "$body" | tr -d '\n' |
        sed -e 's/^[^[]*\[//' -e 's/\][^]]*$//' | tr ',' '\n' | tr -d '"'
}

read_digest() {  # read_digest <tag>
    local tag="$1" token response status digest
    [ -n "$tag" ] || usage
    token="$(pull_token)" || return 1
    # `--head` asks for the manifest's headers alone, `-D -` writes them to stdout and
    # `-o /dev/null` throws the body away, and `-w` appends the status so a tag that is not
    # there is reported as the 404 it is rather than as an empty answer.
    response="$(curl -sS --max-time "$curl_max_seconds" --head -D - -o /dev/null \
        -w 'page-image.sh: status %{http_code}' \
        -H "Authorization: Bearer $token" \
        -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
        "$registry/v2/$repository/manifests/$tag")" || {
        printf 'page-image.sh: %s could not be read for tag %s\n' "$registry" "$tag" >&2
        return 1
    }
    status="$(printf '%s' "$response" | sed -n 's/^page-image.sh: status \(.*\)$/\1/p')"
    [ "$status" = 200 ] || {
        printf 'page-image.sh: %s answered %s for tag %s\n' "$registry" "${status:-nothing}" "$tag" >&2
        return 1
    }
    digest="$(printf '%s' "$response" | tr -d '\r' |
        sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest:[[:space:]]*//p' | head -n 1)"
    [ -n "$digest" ] || {
        printf 'page-image.sh: %s answered for tag %s with no Docker-Content-Digest\n' "$registry" "$tag" >&2
        return 1
    }
    printf '%s\n' "$digest"
}

command="${1:-}"
case "$command" in
    tags)
        [ "$#" -eq 1 ] || usage
        read_tags
        ;;
    digest)
        [ "$#" -eq 2 ] || usage
        read_digest "$2"
        ;;
    *) usage ;;
esac
