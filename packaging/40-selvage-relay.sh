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
# A trailing slash would double up against the request path nginx appends.
upstream="${upstream%/}"

: >"$out"

[ -n "$upstream" ] || exit 0

case "$upstream" in
    http://* | https://*) ;;
    *://*)
        echo "SELVAGE_SERVER: unsupported scheme in '$SELVAGE_SERVER', use http://, https:// or host:port" >&2
        exit 1
        ;;
    *) upstream="http://$upstream" ;;
esac

sed "s|__UPSTREAM__|$upstream|g" "$template" >"$out"
