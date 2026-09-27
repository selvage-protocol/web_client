#!/usr/bin/env bash
# The page image's container smoke: build the image with this repository's own
# Dockerfile, run it under the hardening a public deployment needs, and assert the
# page it serves.
#
#   scripts/container-smoke.sh [PORT]
#
# Needs a Docker daemon with the compose plugin, curl, node, git and python3:
# `.github/workflows/image.yml` runs it on a runner that has all of them, and this
# host has no Docker at all, so the run this script is read from is the CI one.
#
# Proves, in order: `compose.yaml` carries the hardened run a self-hoster gets;
# `docker build` succeeds and the version label reads back off the
# image; the container runs with a read-only root filesystem, every capability
# dropped, no-new-privileges and nothing mounted at all, as the base's uid 101; the
# page is served from the image's own copy of `dist/` — every file's media type,
# the bytes of the shell and of a content-hashed chunk, and the headers the
# one-origin deployment decides; a write is refused; and `/meta` and `/session`,
# which this image does not have with no upstream, are 404. Then the relay, which is
# what `SELVAGE_SERVER` turns on: the two paths are proxied (an unreachable upstream
# is a 502, and it leaves nothing on the container's transcript, which an invite
# URL's token would otherwise reach); a name that does not resolve stops the
# container and its output names the name; and a real server behind the page is
# proved end to end — `/meta` read, a socket upgraded to `101`, and a room minted on
# one connection and joined on a second, all through the page's own published port.
# That last case pulls `ghcr.io/selvage-protocol/selvaged:latest`, the server the
# relay is for, so it needs a route to `ghcr.io`. A pull that fails is the end of the
# run — the server half of the proof is the thing being proved — except where
# `SELVAGE_ALLOW_RELAY_STUB=1` asks for `scripts/relay-stub.mjs` instead, which proves
# the relay and not the server; that opt-in is refused whenever `GITHUB_ACTIONS` is set,
# and a downgrade notifies and names the counterpart it used everywhere it is named.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

# `/tmp` is RAM-backed on some hosts and a build there has exhausted one before:
# keep every artefact inside the checkout.
export TMPDIR="$repo_root/.tmp"
mkdir -p "$TMPDIR"

for tool in docker python3 curl node git; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "container-smoke.sh needs $tool, which this host does not have" >&2
        exit 2
    fi
done
if ! docker compose version >/dev/null 2>&1; then
    echo "container-smoke.sh needs the docker compose plugin to read compose.yaml" >&2
    exit 2
fi

port="${1:-18081}"
image="selvage-web-smoke"
# Named per invocation: a crashed or `SIGKILL`ed run leaves its container behind,
# and a second invocation must not collide with it — or remove its container.
name="selvage-web-smoke-$PPID-$$"
# Everything this run starts, so the trap can take it all down, and the network the
# relay's case puts the page and its server on.
containers=("$name")
network=""
tags="$(scripts/release-tags.sh)"
version="$(printf '%s\n' "$tags" | sed -n 's/^version=//p')"
revision="$(git rev-parse HEAD)"
# The hardening the container run must carry: a read-only root filesystem, every
# capability dropped, and no process able to gain one. Nothing is mounted: the page
# is in the image and nginx's writable paths are the runtime's own `/dev/shm`.
hardening=(--read-only --cap-drop ALL --security-opt no-new-privileges:true)

fail() {
    printf '%s\n' "$*" >&2
    # A red run is read from the API, where a job's transcript is not readable without
    # a signed-in session; an annotation carries the reason to where it can be read.
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        printf '::error::%s\n' "$*"
    fi
    exit 1
}

cleanup() {
    for container in "${containers[@]}"; do
        docker rm -f "$container" >/dev/null 2>&1 || true
    done
    if [ -n "$network" ]; then
        docker network rm "$network" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

# Runs a command whose own failure would otherwise leave nothing but `exit code 1` in a
# transcript that cannot be read from the API: on failure its last lines go out as the
# annotation, so a red run says what the daemon said.
attempt() {  # attempt <what> <command...>
    local what="$1" log="$TMPDIR/container-smoke-attempt.log"
    shift
    if ! "$@" >"$log" 2>&1; then
        cat "$log" >&2
        fail "$what: $(tail -n 3 "$log" | tr '\n' ' ' | cut -c1-400)"
    fi
    cat "$log"
}

echo "=== compose: the hardened run is in the file a self-hoster uses, not only here ==="
compose_json="$(docker compose -f compose.yaml config --format json)"
COMPOSE_JSON="$compose_json" python3 - <<'EOF'
import json
import os
import sys

service = json.loads(os.environ["COMPOSE_JSON"])["services"]["selvage-web"]
failures = []

if service.get("read_only") is not True:
    failures.append(f"read_only is {service.get('read_only')!r}, want true")
if service.get("cap_drop") != ["ALL"]:
    failures.append(f"cap_drop is {service.get('cap_drop')!r}, want ['ALL']")
enabled_no_new_privileges = {
    "no-new-privileges",
    "no-new-privileges:true",
    "no-new-privileges=true",
}
if not any(
    opt in enabled_no_new_privileges
    for opt in service.get("security_opt", [])
):
    failures.append(
        f"security_opt is {service.get('security_opt')!r}, "
        "want an enabled no-new-privileges option"
    )
# Nothing mounted: the image carries the page it serves, and nginx's writable
# paths are the runtime's own /dev/shm.
if service.get("volumes"):
    failures.append(
        f"volumes is {service['volumes']!r}, want none: a public deployment mounts "
        "nothing from the host"
    )
if service.get("privileged"):
    failures.append("privileged is set, want it unset")
for key in ("network_mode", "pid", "ipc"):
    if service.get(key) == "host":
        failures.append(f"{key} is host, want the container's own")

# The host answers on the standard web port while the container keeps its
# unprivileged 8080: that mapping is the whole point of the file.
published = set()
for port in service.get("ports", []):
    if isinstance(port, dict):
        published.add((str(port.get("published")), int(port.get("target", 0))))
    elif isinstance(port, str):
        parts = port.rsplit(":", 2)
        if len(parts) >= 2:
            published.add((parts[-2], int(parts[-1].split("/")[0])))
if ("80", 8080) not in published:
    failures.append(
        f"port 8080 is published as {sorted(published) or 'nothing'}, want '80': the "
        "container cannot bind below 1024 with every capability dropped"
    )

if failures:
    print("\n".join(failures), file=sys.stderr)
    sys.exit(1)
print(
    "compose OK: read-only root filesystem, all capabilities dropped, "
    "no-new-privileges, nothing mounted, host port 80 to container 8080"
)
EOF

echo "=== build: docker build of this repository's Dockerfile ==="
attempt 'docker build' docker build --tag "$image" \
    --build-arg "VERSION=$version" \
    --build-arg "REVISION=$revision" \
    .

echo "=== build: the image carries the version and revision it was built with ==="
label() { docker inspect --format "{{index .Config.Labels \"$1\"}}" "$image"; }
got_version="$(label org.opencontainers.image.version)"
[ "$got_version" = "$version" ] || fail "the image's version label is '$got_version', want '$version'"
got_revision="$(label org.opencontainers.image.revision)"
[ "$got_revision" = "$revision" ] || fail "the image's revision label is '$got_revision', want '$revision'"
echo "image OK: version $got_version, revision $got_revision"

echo "=== run: the hardened container, no mount, the image's own command ==="
attempt 'docker run' docker run --detach --name "$name" "${hardening[@]}" \
    --publish "127.0.0.1:$port:8080" \
    "$image"

# The flags were passed; this asserts the daemon took them, and that nothing else
# came along. A run that silently fell back to a writable root, to the host's user
# or to the host's namespaces would otherwise pass every HTTP assertion below.
field() { docker inspect --format "$1" "$name"; }
require_field() {  # require_field <format> <want> <what>
    local got
    got="$(field "$1")"
    [ "$got" = "$2" ] || fail "$3 is $got, want $2"
    echo "$3: $got"
}

# A flag that was not passed reports as `null` or as an empty list, depending on the
# field, and both mean none was set: what must not happen is a value.
require_none() {  # require_none <format> <what>
    local got
    got="$(field "$1")"
    case "$got" in
        '' | 'null' | '[]') echo "$2: none" ;;
        *) fail "$2 is $got, want none" ;;
    esac
}

require_field '{{.HostConfig.ReadonlyRootfs}}' 'true' 'the read-only root filesystem'
require_field '{{json .HostConfig.CapDrop}}' '["ALL"]' 'the dropped capabilities'
require_none '{{json .HostConfig.CapAdd}}' 'the added capabilities'
require_field '{{.HostConfig.Privileged}}' 'false' 'the privileged flag'
require_none '{{json .Mounts}}' 'the mounts'
field '{{json .HostConfig.SecurityOpt}}' | grep -q 'no-new-privileges' \
    || fail "the security options are $(field '{{json .HostConfig.SecurityOpt}}'), want no-new-privileges among them"
# The base image's own user, which the daemon reports either way it was written.
user="$(field '{{.Config.User}}')"
case "$user" in
    101 | 101:101) ;;
    *) fail "the container runs as '$user', want the base image's uid 101" ;;
esac
echo "run OK: read-only root filesystem, all capabilities dropped, no-new-privileges, no mount, uid $user"

echo "=== serve: the page the image carries, and only it ==="
base="http://127.0.0.1:$port"
# The assertion is `scripts/check-page.sh`, shared with the release read-back; the
# container's own transcript goes with any failure, which is what says whether the
# page was wrong or the container never started.
scripts/check-page.sh "$base" || {
    docker logs "$name" >&2 || true
    exit 1
}

echo "=== build: the image declares the knob the room's other image sets ==="
# The server's compose file sets `SELVAGE_SERVER` on this image and nothing in that
# repository runs the image, so the name is pinned here as well as in
# `scripts/test-relay-config.sh`: a container on the image's own defaults still carries
# the variable, which is what `docker image inspect` has to show for an operator to
# find the knob at all.
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image" | grep -qx 'SELVAGE_SERVER=' \
    || fail "the image's own environment carries no SELVAGE_SERVER, which is the name the server's compose file sets"
echo "the image declares SELVAGE_SERVER (empty): the knob shows in 'docker image inspect'"

echo "=== relay: no SELVAGE_SERVER leaves the include empty ==="
# `check-page.sh` above asserted one half of the absence — `/meta` and `/session`
# are 404 — and this is the other: the file the entrypoint wrote is empty, so
# nothing about the container names an upstream or resolves a name.
attempt 'docker exec (unconfigured) cat' docker exec "$name" cat /dev/shm/selvage-relay.conf

# A literal address inside the container that nothing listens on. nginx resolves
# no name there, the relay is present, and an unreachable upstream answers 502
# rather than the page's own 404 — which is what tells a wired relay from an
# absent one. The page itself is unchanged.
echo "=== relay: with SELVAGE_SERVER set the two endpoints are proxied ==="
docker rm -f "$name" >/dev/null
name="selvage-web-smoke-relay-$PPID-$$"
containers+=("$name")
attempt 'docker run (relay)' docker run --detach --name "$name" "${hardening[@]}" \
    --env SELVAGE_SERVER=http://127.0.0.1:9 \
    --publish "127.0.0.1:$port:8080" \
    "$image"

deadline=$((SECONDS + 30))
last=""
until last="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$base/" 2>&1)"; do
    [ "$SECONDS" -lt "$deadline" ] || fail "$base/ did not answer within 30s with a relay configured (last: $last)"
    sleep 0.5
done
[ "$last" = "200" ] || fail "the page answered $last with a relay configured, want 200"
echo "the page is still served with a relay configured: / is $last"

attempt 'docker exec (relay) cat' docker exec "$name" cat /dev/shm/selvage-relay.conf

# The token an invite URL carries, in every request a guest makes through the page: the
# page itself, and the two endpoints the relay proxies. Nothing here is a secret; what it
# proves is that no byte of a request line reaches the transcript.
sentinel="SELVAGE-SMOKE-TRANSCRIPT-SENTINEL-4f1c"
for path in /meta /session; do
    status="$(curl -sS --max-time 10 -o "$TMPDIR/relay-body" -w '%{http_code}' "$base$path?room=smoke-room&token=$sentinel")"
    [ "$status" = "502" ] || fail "$path answered $status with SELVAGE_SERVER set, want 502 from the relay"
    if cmp -s "$TMPDIR/relay-body" "$repo_root/dist/404.html"; then
        fail "$path answered the page's own 404 page, so the relay is not proxying"
    fi
    echo "relayed: $path is $status, from the configured upstream"
done

# An invite is a page link carrying the room and its token, so it is the request whose
# line must not be kept, and the status it answers is the page's own.
invite="$base/?room=smoke-room&token=$sentinel"
invite_status="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$invite")"
[ "$invite_status" = "200" ] || fail "an invite-shaped request answered $invite_status, want the page's own 200"

# That 502 is below the level this image's error log keeps and its access log is off, so
# the container's own transcript has nothing about the request or the upstream it could
# not reach. The token in an invite URL travels in the request line, which is exactly what
# must not land there; a regression to an `error`-level log, or to a filter rather than
# `off`, shows up here.
transcript="$(docker logs "$name" 2>&1 || true)"
if printf '%s\n' "$transcript" | grep -qE '127\.0\.0\.1:9|connect\(\) failed|no live upstreams|\[error\]|\[warn\]'; then
    printf '%s\n' "$transcript" >&2
    fail "the 502 reached the container's transcript, which an invite URL's token would reach too"
fi
# The whole transcript and the invite URL's own token: the fault-level grep above only
# reaches what the relay logged about its upstream, and a regression to
# `access_log /dev/stdout` keeps no fault at all — what it keeps is
# `"GET /?room=…&token=…" 200`, which is exactly what must not be kept.
if printf '%s\n' "$transcript" | grep -qF "$sentinel"; then
    printf '%s\n' "$transcript" >&2
    fail "the invite URL's token reached the container's transcript, which PROTOCOL.md §12 forbids a deployment to log"
fi
echo "the 502 left nothing on the transcript, and neither did the invite URL's token: the error log is at crit and the access log is off"

echo "=== relay: a name that does not resolve stops the container, naming it ==="
# `proxy_pass` resolves its host while nginx loads its configuration, so a misspelled
# name, or a page started before its server, is fatal at startup: the container exits and
# says `host not found in upstream`, rather than starting a page that 502s every join.
# A silent fallback to a page with no relay is the failure this case exists to catch.
docker rm -f "$name" >/dev/null
name="selvage-web-smoke-unresolved-$PPID-$$"
containers+=("$name")
attempt 'docker run (unresolved upstream)' docker run --detach --name "$name" "${hardening[@]}" \
    --env SELVAGE_SERVER=http://no-such-host.invalid:8080 \
    --publish "127.0.0.1:$port:8080" \
    "$image"

deadline=$((SECONDS + 60))
while [ "$(field '{{.State.Running}}')" = "true" ]; do
    [ "$SECONDS" -lt "$deadline" ] || {
        docker logs "$name" >&2 || true
        fail "the container is still running with an upstream name that does not resolve"
    }
    sleep 0.5
done
code="$(field '{{.State.ExitCode}}')"
[ "$code" != "0" ] || fail "the container exited 0 with an upstream name that does not resolve"
unresolved="$(docker logs "$name" 2>&1 || true)"
printf '%s\n' "$unresolved" | grep -qF 'no-such-host.invalid' || {
    printf '%s\n' "$unresolved" >&2
    fail "the container exited $code without naming the upstream it could not resolve"
}
# The name is what both a refusal and nginx would name, so the name alone proves
# neither: nginx says `host not found in upstream`, and the entrypoint's own refusal
# would be the validator refusing the value before nginx ever ran.
printf '%s\n' "$unresolved" | grep -qF 'host not found in upstream' || {
    printf '%s\n' "$unresolved" >&2
    fail "the container exited $code without nginx's own 'host not found in upstream', so nginx may never have loaded the relay"
}
if printf '%s\n' "$unresolved" | grep -qF 'SELVAGE_SERVER:'; then
    printf '%s\n' "$unresolved" >&2
    fail "the exit was the entrypoint refusing the value, not nginx failing to resolve the name"
fi
printf '%s\n' "$unresolved" | tail -n 1
echo "unresolvable upstream: the container exited $code, nginx said 'host not found in upstream' and the output names no-such-host.invalid"

echo "=== relay: a server behind the page, and a room joined through it ==="
# The value below is the one the other repository's compose file writes — the bare service
# name and port — so this pins `SELVAGE_SERVER`, `/meta`, `/session` and one origin as the
# contract between the two images.
server_name="selvaged"
server_image="${SELVAGE_SERVER_IMAGE:-ghcr.io/selvage-protocol/selvaged:latest}"
# What the relay was actually proved against, which every line that names it has to say.
server_label="$server_image"
network="selvage-web-smoke-$PPID-$$"
server_container="selvage-web-smoke-server-$PPID-$$"
containers+=("$server_container")
attempt 'docker network create' docker network create "$network"

if timeout 300 docker pull "$server_image" >"$TMPDIR/server-pull.log" 2>&1; then
    # The build the daemon now holds under that tag: `latest` moves, so a tag alone cannot
    # say which server this run seated a room against. Empty where the daemon reports no
    # repository digest, which is a locally built image.
    server_digest="$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$server_image" 2>/dev/null || true)"
    if [ -n "$server_digest" ]; then
        server_label="$server_image ($server_digest)"
        echo "server under test: $server_image, the published reference server, pulled as $server_digest"
    else
        echo "server under test: $server_image, the published reference server, whose build the daemon reports no digest for"
    fi
    server=(docker run --detach --name "$server_container" --network "$network" \
        --network-alias "$server_name" "$server_image")
else
    # The honest counterpart is `selvaged`, and nothing else proves that `selvaged` is
    # what the relay forwards to: a registry hiccup, a deleted `latest` or a renamed
    # package would otherwise turn the strongest case in this script into a green run
    # against a stand-in. So a failed pull ends the run here, and in CI always —
    # `SELVAGE_ALLOW_RELAY_STUB` is read only outside it, where the failure is a
    # local host with no route to `ghcr.io` rather than a signal about the image.
    pull_note="$(tail -n 2 "$TMPDIR/server-pull.log" | tr '\n' ' ')"
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        fail "the published server image $server_image could not be pulled, so the relay was not proved against a real server: $pull_note"
    fi
    if [ "${SELVAGE_ALLOW_RELAY_STUB:-}" != "1" ]; then
        fail "the published server image $server_image could not be pulled, so the relay was not proved against a real server: $pull_note (set SELVAGE_ALLOW_RELAY_STUB=1 to run the relay proof against scripts/relay-stub.mjs instead, which proves the relay and not the server)"
    fi
    # The stand-in answers `/meta` with a Selvage body and upgrades `/session` in the
    # shape the checker asserts. That proves the relay and not the server, and the
    # banner, the label and the final line are the whole of the difference.
    echo "server under test: scripts/relay-stub.mjs (SELVAGE_ALLOW_RELAY_STUB=1), which proves the relay and not the server"
    printf '::warning::the relay proof is running against scripts/relay-stub.mjs, not %s, because that image could not be pulled: %s\n' "$server_image" "$pull_note"
    server_label="scripts/relay-stub.mjs (SELVAGE_ALLOW_RELAY_STUB=1)"
    stub_image="${SELVAGE_STUB_IMAGE:-node:22-alpine}"
    attempt 'docker pull (stub runtime)' docker pull "$stub_image"
    server=(docker run --detach --name "$server_container" --network "$network" \
        --network-alias "$server_name" \
        --mount "type=bind,source=$repo_root/scripts/relay-stub.mjs,target=/stub.mjs,readonly" \
        "$stub_image" node /stub.mjs)
fi
attempt 'docker run (server)' "${server[@]}"

docker rm -f "$name" >/dev/null
name="selvage-web-smoke-relayed-$PPID-$$"
containers+=("$name")
attempt 'docker run (relayed page)' docker run --detach --name "$name" "${hardening[@]}" \
    --network "$network" \
    --env SELVAGE_SERVER="$server_name:8080" \
    --publish "127.0.0.1:$port:8080" \
    "$image"

# The wait is on the relayed `/meta`, which answers 200 only once both containers are up:
# a 502 while the server is still starting is this loop's business, not a failure.
deadline=$((SECONDS + 90))
last=""
until last="$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' "$base/meta" 2>&1)" && [ "$last" = "200" ]; do
    [ "$SECONDS" -lt "$deadline" ] || {
        docker logs "$name" >&2 || true
        docker logs "$server_container" >&2 || true
        fail "$base/meta did not answer 200 within 90s through the relay (last: $last)"
    }
    sleep 0.5
done
echo "the relay reached the server: $base/meta is 200"

attempt 'docker exec (relayed) cat' docker exec "$name" cat /dev/shm/selvage-relay.conf
# `/meta` read, the upgrade to `101`, and a room minted on one connection and joined on a
# second — every one of them through the page's own published port, which is the property
# this branch exists for.
attempt 'the relay proof' node scripts/check-relay.mjs "$base"

echo "=== the relay container's own transcript ==="
docker logs "$name" || true

echo "container smoke OK: $image built, ran hardened and unmounted, served $base from its own dist/, refused a write, answered 404 on the two endpoints with no upstream, relayed them when configured without logging the attempt, exited with a name that does not resolve, and seated a room through itself against $server_label"
