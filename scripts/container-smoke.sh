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
# which this image does not have, are 404.
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
    docker rm -f "$name" >/dev/null 2>&1 || true
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
if not any(
    opt.startswith("no-new-privileges")
    for opt in service.get("security_opt", [])
):
    failures.append(
        f"security_opt is {service.get('security_opt')!r}, "
        "want no-new-privileges among it"
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

echo "=== the container's own transcript ==="
docker logs "$name" || true

echo "container smoke OK: $image built, ran hardened and unmounted, served $base from its own dist/, and refused a write"
