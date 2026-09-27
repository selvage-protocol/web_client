#!/bin/sh
# Writes the origin relay's location blocks from `SELVAGE_SERVER`, the server this
# page's origin relays `/session` and `/meta` to. The page image can then be the
# single origin of a room, the shape `selvaged --serve-page` has on its own.
#
# The file goes under the runtime's tmpfs because the image runs with a read-only
# root filesystem; `packaging/default.conf` includes it. With `SELVAGE_SERVER`
# unset or empty the file is empty, so the page is served and `/session` and
# `/meta` answer 404 like any other path this image does not have, and nothing the
# container starts depends on a name resolving.
#
# The base image's `/docker-entrypoint.sh` runs this before nginx starts. The paths
# are overridable so this can be read and exercised without a container.
set -eu

out="${SELVAGE_RELAY_CONF:-/dev/shm/selvage-relay.conf}"
template="${SELVAGE_RELAY_TEMPLATE:-/etc/nginx/relay.conf.template}"
upstream="${SELVAGE_SERVER:-}"

# The file has to exist even with no relay configured: `default.conf` includes it by
# name, and nginx treats an include of a file that is not there as fatal.
: >"$out"

[ -n "$upstream" ] || exit 0

# Nothing the value carries is escaped before it reaches `proxy_pass`, so its shape is
# settled here: a space, a newline or a `|` would otherwise reach nginx as a broken or
# injected directive, with nothing said about where it came from.
refuse() {
    printf 'SELVAGE_SERVER: %s\n' "$1" >&2
    exit 1
}

scheme="http"
case "$upstream" in
    https://*) scheme="https"; authority="${upstream#https://}" ;;
    http://*) authority="${upstream#http://}" ;;
    *://*) refuse "'$upstream' carries an unsupported scheme; use http://, https:// or a bare host:port" ;;
    *) authority="$upstream" ;;
esac

# A trailing slash would double up against the request path nginx appends.
authority="${authority%/}"
upstream="$scheme://$authority"

host=""
port=""
case "$authority" in
    \[*)
        # A bracketed IPv6 address, which is the only way a host may carry a colon.
        host="${authority%%\]*}"
        [ "$host" != "$authority" ] || refuse "'$upstream' opens a bracket it does not close"
        host="${host#\[}"
        case "$host" in
            "" | *[!0-9A-Fa-f:.]*)
                refuse "'$upstream' carries '$host' between brackets, which is not an IPv6 address"
                ;;
            *:*) ;;
            *) refuse "'$upstream' carries '$host' between brackets, which is not an IPv6 address" ;;
        esac
        rest="${authority#*\]}"
        case "$rest" in
            "") ;;
            :*) port="${rest#:}" ;;
            *) refuse "'$upstream' carries '$rest' after its bracketed address, where only a :port may follow" ;;
        esac
        ;;
    *)
        case "$authority" in
            *:*:*)
                refuse "'$upstream' carries more than one ':', so an IPv6 address needs brackets"
                ;;
            *:*)
                host="${authority%:*}"
                port="${authority##*:}"
                ;;
            *) host="$authority" ;;
        esac
        case "$host" in
            "") refuse "'$upstream' names no host" ;;
            *[!A-Za-z0-9._-]*)
                refuse "'$upstream' is not a host and port: a host is letters, digits, dots, hyphens and underscores, followed by an optional :port"
                ;;
        esac
        case "$authority" in
            *:*) [ -n "$port" ] || refuse "'$upstream' has nothing after its ':' where a port belongs" ;;
        esac
        ;;
esac

if [ -n "$port" ]; then
    case "$port" in
        *[!0-9]*) refuse "'$upstream' carries '$port' after its ':', which is not a port" ;;
    esac
    digits="$(printf '%s' "$port" | sed 's/^0*//')"
    [ -n "$digits" ] || refuse "'$upstream' names port 0"
    case "$digits" in
        ??????*) refuse "'$upstream' names port '$port', above 65535" ;;
    esac
    [ "$digits" -le 65535 ] || refuse "'$upstream' names port '$port', above 65535"
fi

sed "s|__UPSTREAM__|$upstream|g" "$template" >"$out"
