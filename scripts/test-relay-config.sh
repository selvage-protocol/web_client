#!/usr/bin/env bash
# The origin relay's configuration against SELVAGE_SERVER, without a container.
#
#   scripts/test-relay-config.sh
#
# Runs the image's own `packaging/40-selvage-relay.sh` the way the page image's
# entrypoint does — pointing its output at a file of this test's choosing — and asserts
# what it writes: nothing when no server is configured, and the two proxied locations
# when one is, with the upgrade passthrough, the timeouts and the TLS handling the
# template carries. A value that is not a host and an optional port is refused with a
# sentence rather than written into the configuration. Where an `nginx` is on PATH it
# parses the result inside the image's own `packaging/nginx.conf` and
# `packaging/default.conf`, their paths redirected into this test's own directory, and a
# configuration nginx *does* reject is parsed with it too, because a parse that cannot
# fail is not a check. It also reads the Dockerfile, `compose.yaml` and
# `packaging/nginx.conf` back, so the file the script writes is the one nginx includes,
# the script is installed to run at all, and the knob the room's other image names is the
# one this image reads.
#
# Needs bash and a `sh`; the `checks` job installs Debian's `nginx-light` so the parse
# runs there, and this host's run says when it could not run it. No Docker.
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

for file in "$script" "$template" packaging/default.conf packaging/nginx.conf Dockerfile compose.yaml; do
    [ -s "$file" ] || fail "$file is missing or empty, so this test reaches nothing"
done
# What the entrypoint relies on: `/docker-entrypoint.sh` launches a `*.sh` in
# `/docker-entrypoint.d/` only when it is executable, and the Dockerfile leaves the mode
# to the file rather than forcing it with `--chmod`.
[ -x "$script" ] || fail "$script is not executable, so the base image's entrypoint would skip it"
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
# The relay is `/session` and `/meta` and nothing else: a location matching `/` here
# would shadow the page that is the whole point of putting them on this origin.
locations="$(grep -c '^location ' "$relay")"
[ "$locations" = "2" ] || fail "the relay carries $locations locations, want the two endpoints"
grep -q '    proxy_pass http://server.internal:8080;' "$relay" \
    || fail "the relay does not proxy to the configured server"
grep -q '    proxy_http_version 1.1;' "$relay" || fail "the upgrade needs HTTP/1.1"
grep -q '    proxy_set_header Upgrade \$http_upgrade;' "$relay" || fail "no Upgrade passthrough"
grep -q '    proxy_set_header Connection \$connection_upgrade;' "$relay" \
    || fail "no Connection passthrough"
# The upstream's own name and port, never the page's: a server behind a front that routes
# by name refuses a request carrying the origin the page is served under.
grep -qF '    proxy_set_header Host $proxy_host;' "$relay" \
    || fail "the relay does not send the upstream's own Host"
if grep -qF '    proxy_set_header Host $host;' "$relay"; then
    fail "the relay sends the page's own Host to the upstream"
fi
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
generate 0 "server.internal:8080"
grep -q 'proxy_pass http://server.internal:8080;' "$relay" \
    || fail "a bare host:port did not default to http"
# The shape the room's other image writes in its own compose.yaml.
generate 0 "selvaged:8080"
grep -q 'proxy_pass http://selvaged:8080;' "$relay" \
    || fail "the bare service name and port the other compose file uses was not taken"
echo "scheme handling: trailing slash stripped, https kept below, bare host:port defaulted to http"

echo "=== https: SNI and verification against the image's CA bundle ==="
generate 0 "https://server.internal:8443"
grep -q '    proxy_pass https://server.internal:8443;' "$relay" || fail "https was not kept"
grep -q '^    proxy_ssl_server_name on;$' "$relay" || fail "an https upstream sends no SNI"
# Verification and the depth are counted, not grepped once: a location that lost one of
# them would leave the parse green and that half of the relay unverified, and nginx's
# default for `proxy_ssl_verify` is off.
verified="$(grep -c '^    proxy_ssl_verify on;$' "$relay")"
[ "$verified" = "2" ] || fail "$verified of the two locations verify the upstream's certificate, want both"
depth="$(grep -c '^    proxy_ssl_verify_depth 4;$' "$relay")"
[ "$depth" = "2" ] || fail "$depth of the two locations bound the chain's depth, want both"
grep -q '^    proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;$' "$relay" \
    || fail "the verification names no CA bundle"
generated="$(grep -c '^    proxy_ssl_server_name on;$' "$relay")"
[ "$generated" = "2" ] || fail "$generated of the two locations turn SNI on, want both"
# A path named in a directive is not a file: nginx parses it without reading it. The
# bundle the two locations name is read back out of the template and held to the check the
# Dockerfile makes against the base image, so the path and the file it is meant to be
# cannot drift apart, and a location that lost its bundle is caught here.
named="$(grep -c '^    proxy_ssl_trusted_certificate ' "$template")"
[ "$named" = "2" ] || fail "$template names a CA bundle under $named locations, want the two"
ca_bundle="$(sed -n 's|^    proxy_ssl_trusted_certificate \(.*\);$|\1|p' "$template" | sort -u)"
[ -n "$ca_bundle" ] || fail "$template names no CA bundle in the shape this test reads"
[ "$(printf '%s\n' "$ca_bundle" | grep -c .)" = "1" ] \
    || fail "the two locations name different CA bundles: $(printf '%s' "$ca_bundle" | tr '\n' ' ')"
grep -qF "test -e $ca_bundle" Dockerfile \
    || fail "the Dockerfile does not prove that $ca_bundle exists in the image it builds"
echo "https://server.internal:8443: SNI on, verification against $ca_bundle, which the Dockerfile proves is in the image"

echo "=== an address that is not a host and port is refused ==="
# Each of these would otherwise reach nginx as a broken or injected directive: the value
# is substituted into `proxy_pass` with nothing escaping it.
refused_ok=0
refuse() {  # refuse <value> <what the sentence must say>
    generate 1 "$1"
    grep -qF -- "$2" "$work/err" || {
        printf 'SELVAGE_SERVER=%s said: %s\n' "$1" "$(cat "$work/err")" >&2
        fail "the refusal for '$1' does not say '$2'"
    }
    printf 'refused as it should be: %q -> %s\n' "$1" "$(head -n 1 "$work/err")"
    refused_ok=$((refused_ok + 1))
}
refuse 'ftp://server.internal' 'unsupported scheme'
refuse 'http://server internal:8080' 'is not a host and port'
refuse 'http://server|internal' 'is not a host and port'
refuse "$(printf 'http://server\ninternal:8080')" 'is not a host and port'
refuse 'http://' 'names no host'
refuse 'http://server.internal:' 'where a port belongs'
refuse 'http://server.internal:80 80' 'is not a port'
refuse 'http://server.internal:8081x' 'is not a port'
refuse 'http://server.internal:99999' 'above 65535'
refuse 'http://server.internal:0' 'names port 0'
refuse 'http://[::1' 'opens a bracket it does not close'
refuse 'http://[server.internal]' 'not an IPv6 address'
refuse '::1' "more than one ':'"
[ "$refused_ok" = "13" ] || fail "$refused_ok refusals ran, want the 13 this test names"
[ ! -s "$relay" ] || fail "a refused value left a relay behind: $(cat "$relay")"

# The refusal echoes the value, and the value is an environment variable: a newline in it
# must not become a second line of the container's output, where a reader of the transcript
# would take it for a line of nginx's own.
generate 1 "$(printf 'http://server\n[crit] forged line')"
lines="$(wc -l <"$work/err" | tr -d ' ')"
[ "$lines" = "1" ] || {
    cat "$work/err" >&2
    fail "a refused value carrying a newline produced $lines lines, want one"
}
head -n 1 "$work/err" | grep -q '^SELVAGE_SERVER: ' \
    || fail "the refusal for a value carrying a newline does not name SELVAGE_SERVER: $(cat "$work/err")"
if grep -q '^\[crit\]' "$work/err"; then
    cat "$work/err" >&2
    fail "a value carrying a newline forged a line beginning with [crit]"
fi
echo "a value carrying a newline stays one line, under the name of the variable it came from"

# A bracketed IPv6 address with a port is a host the other rules would refuse.
generate 0 "http://[fe80::1]:8080"
grep -q 'proxy_pass http://\[fe80::1\]:8080;' "$relay" || fail "a bracketed IPv6 address was not taken"
echo "a bracketed IPv6 address with a port is taken"

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
if grep -q -- '--chmod' Dockerfile; then
    fail "the Dockerfile forces a mode on a file that carries its own"
fi
grep -q '^ENV SELVAGE_SERVER=' Dockerfile \
    || fail "the Dockerfile does not declare SELVAGE_SERVER, so the knob is invisible to 'docker image inspect'"
# The other repository's compose file sets this name on this image; nothing there runs
# the image, so this is where the name is pinned.
grep -q 'SELVAGE_SERVER' compose.yaml || fail "compose.yaml names no SELVAGE_SERVER"
grep -q 'SELVAGE_SERVER: ' compose.yaml || fail "compose.yaml passes no SELVAGE_SERVER value"

echo "=== nginx: the configuration this writes, parsed by an nginx if there is one ==="
if ! command -v nginx >/dev/null 2>&1; then
    echo "no nginx on this host, so the generated configuration was not parsed"
    echo "relay config OK: absent with no SELVAGE_SERVER, the two proxied locations, the TLS handling,"
    echo "and a refusal for anything that is not a host and port (nginx's parse not run here)"
    exit 0
fi
echo "nginx: $(command -v nginx) $(nginx -v 2>&1)"

# The image's own http-level configuration and its server block, with the two paths they
# carry redirected into this test: nginx.conf's `include conf.d/*.conf` is the server
# block, and default.conf's include of `/dev/shm/selvage-relay.conf` is the file the
# script above just wrote. A redirection that matched nothing would leave the original
# path in place, so both are asserted to have landed.
mkdir -p "$work/conf.d"
sed "s|include /etc/nginx/conf.d/\*.conf;|include $work/conf.d/*.conf;|" packaging/nginx.conf >"$work/nginx.conf" \
    || fail "packaging/nginx.conf could not be read"
grep -qF "include $work/conf.d/*.conf;" "$work/nginx.conf" \
    || fail "the server block's include was not redirected, so this parse would read the host's"
sed "s|include /dev/shm/selvage-relay.conf;|include $relay;|" packaging/default.conf >"$work/conf.d/default.conf" \
    || fail "packaging/default.conf could not be read"
grep -qF "include $relay;" "$work/conf.d/default.conf" \
    || fail "the relay include was not redirected, so this parse would not read the generated file"

parsed=0
parse() {  # parse <expect: ok|refused> <what>
    local want="$1" what="$2" got=ok
    nginx -t -c "$work/nginx.conf" >"$work/nginx.log" 2>&1 || got=refused
    [ "$got" = "$want" ] || {
        cat "$work/nginx.log" >&2
        fail "$what: nginx $got this configuration, want $want"
    }
    printf 'nginx %s: %s\n' "$got" "$what"
    parsed=$((parsed + 1))
}

# A literal address rather than a name: nginx resolves the upstream while it loads the
# configuration, so a name this host cannot resolve is fatal there (which is the
# behaviour the page image is built on), and this test does not depend on DNS.
generate 0 "http://127.0.0.1:8080"
parse ok "the relay for an http upstream"
generate 0 "https://127.0.0.1:8443"
parse ok "the relay for an https upstream, with the CA bundle's path"
# The case that says the parse is a parse rather than a line that always passes: the
# relay is generated first and then made invalid, so what nginx reads is the file the
# entrypoint wrote with one directive nginx has never heard of in it. It is the file
# `default.conf` includes, which is the point — a parse that read something else would
# pass this case too.
generate 0 "http://127.0.0.1:8080"
printf 'selvage_bogus_directive on;\n' >>"$relay"
parse refused "a configuration nginx rejects"
generate 0 "http://127.0.0.1:8080"
parse ok "the relay again, so the refusal above was the broken file"
[ "$parsed" = "4" ] || fail "$parsed parses ran, want the 4 this test names"

echo "relay config OK: absent with no SELVAGE_SERVER, the two proxied locations, the TLS handling,"
echo "a refusal for anything that is not a host and port, and nginx reading both configurations"
