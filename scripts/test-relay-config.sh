#!/usr/bin/env bash
# The origin relay's presence against SELVAGE_SERVER, without a container.
#
#   scripts/test-relay-config.sh
#
# Runs the image's own `packaging/40-selvage-relay.sh` the way the page image's
# entrypoint does — pointing its output at a file of this test's choosing — and
# asserts what it writes: nothing when no server is configured, and the two proxied
# locations when one is. It also reads `packaging/default.conf`, `packaging/nginx.conf`
# and the Dockerfile back, so the file the script writes is the one nginx includes
# and the script is installed to run at all.
#
# Needs bash and a `sh`; no Docker, so it runs in the `checks` job beside the other
# script suites.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

work="$repo_root/.tmp/test-relay-config"
rm -rf "$work"
mkdir -p "$work"

script="packaging/40-selvage-relay.sh"
template="packaging/relay.conf.template"
relay="$work/relay.conf"

fail() {
    printf '%s\n' "$*" >&2
    # A red run is read from the API, where a job's transcript is not readable without
    # a signed-in session; an annotation carries the reason to where it can be read.
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '::error::%s\n' "$*"
    fi
    exit 1
}

for file in "$script" "$template" packaging/default.conf packaging/nginx.conf Dockerfile; do
    [ -s "$file" ] || fail "$file is missing or empty, so this test reaches nothing"
done
# The test only means something while the template carries the placeholder the
# script substitutes and default.conf includes the path the script writes.
grep -q '__UPSTREAM__' "$template" || fail "$template no longer carries __UPSTREAM__"
grep -q 'include /dev/shm/selvage-relay.conf;' packaging/default.conf \
    || fail "default.conf does not include the file the relay script writes"

# generate <expected-status> <value>: run the entrypoint script into $relay.
generate() {
    local want="$1" value="${2-}" status=0
    SELVAGE_SERVER="$value" \
        SELVAGE_RELAY_CONF="$relay" \
        SELVAGE_RELAY_TEMPLATE="$repo_root/$template" \
        sh "$script" >"$work/out" 2>"$work/err" || status=$?
    [ "$status" = "$want" ] || {
        cat "$work/out" "$work/err" >&2
        fail "SELVAGE_SERVER='$value' exited $status, want $want"
    }
}

echo "=== absence: unset and empty SELVAGE_SERVER leave no relay ==="
# Unset is not the same as empty in a shell, so cover both entry points.
SELVAGE_RELAY_CONF="$relay" SELVAGE_RELAY_TEMPLATE="$repo_root/$template" \
    env -u SELVAGE_SERVER sh "$script"
[ -f "$relay" ] || fail "unset SELVAGE_SERVER wrote no file, so nginx's include would fail"
[ ! -s "$relay" ] || fail "unset SELVAGE_SERVER wrote a relay: $(cat "$relay")"
generate 0 ""
[ ! -s "$relay" ] || fail "empty SELVAGE_SERVER wrote a relay: $(cat "$relay")"
if grep -q 'proxy_pass' "$relay"; then
    fail "the unconfigured relay names an upstream: $(cat "$relay")"
fi
echo "no upstream: an empty include, no proxy_pass"

echo "=== presence: a configured server gets the two proxied locations ==="
generate 0 "http://server.internal:8080"
grep -q '^location = /session {$' "$relay" || fail "no '/session' location"
grep -q '^location = /meta {$' "$relay" || fail "no '/meta' location"
grep -q '    proxy_pass http://server.internal:8080;' "$relay" \
    || fail "the relay does not proxy to the configured server"
grep -q '    proxy_http_version 1.1;' "$relay" || fail "the upgrade needs HTTP/1.1"
grep -q '    proxy_set_header Upgrade \$http_upgrade;' "$relay" || fail "no Upgrade passthrough"
grep -q '    proxy_set_header Connection \$connection_upgrade;' "$relay" \
    || fail "no Connection passthrough"
grep -q '    proxy_set_header Host \$host;' "$relay" || fail "the Host is not passed through"
grep -q '    proxy_connect_timeout 5s;' "$relay" || fail "no connect timeout"
grep -q '    proxy_read_timeout 300s;' "$relay" || fail "no long-lived read timeout"
grep -q '    proxy_send_timeout 300s;' "$relay" || fail "no long-lived send timeout"
if grep -q '__UPSTREAM__' "$relay"; then
    fail "the placeholder reached nginx: $(cat "$relay")"
fi
echo "upstream http://server.internal:8080: two proxied locations, upgrade and timeouts"

echo "=== the scheme: https is kept, a bare host:port defaults to http ==="
generate 0 "http://server.internal:8080/"
grep -q 'proxy_pass http://server.internal:8080;' "$relay" \
    || fail "a trailing slash was not stripped"
generate 0 "https://server.internal:8443"
grep -q 'proxy_pass https://server.internal:8443;' "$relay" || fail "https was not kept"
generate 0 "server.internal:8080"
grep -q 'proxy_pass http://server.internal:8080;' "$relay" \
    || fail "a bare host:port did not default to http"
echo "scheme handling: trailing slash stripped, https kept, bare host:port defaulted to http"

echo "=== an unsupported scheme is refused ==="
generate 1 "ftp://server.internal"
grep -q 'unsupported scheme' "$work/err" || fail "the refusal does not say what is wrong"

echo "=== wiring: nginx reads what the script writes, and the image installs it ==="
grep -q 'map \$http_upgrade \$connection_upgrade' packaging/nginx.conf \
    || fail "nginx.conf defines no \$connection_upgrade for the relay to use"
grep -q 'access_log off;' packaging/nginx.conf || fail "the access log is on"
if grep -q 'access_log /dev/stdout' packaging/nginx.conf; then
    fail "the access log still goes to stdout, where an invite URL's token would land"
fi
grep -q 'packaging/40-selvage-relay.sh /docker-entrypoint.d/40-selvage-relay.sh' Dockerfile \
    || fail "the Dockerfile does not install the relay entrypoint script"
grep -q 'packaging/relay.conf.template /etc/nginx/relay.conf.template' Dockerfile \
    || fail "the Dockerfile does not install the relay template"

echo "relay config OK: absent with no SELVAGE_SERVER, the two proxied locations with one"
