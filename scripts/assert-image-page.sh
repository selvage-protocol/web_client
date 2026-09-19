#!/usr/bin/env bash
# The page image's release read-back: run the image that was built — once per
# architecture its manifest list carries — under the same hardening as the smoke,
# and assert the version it is tagged with and the page it serves.
#
#   scripts/assert-image-page.sh <IMAGE_REF> <VERSION> [PORT]
#
# Shared by the non-pushing rehearsal and by `publish`, so a release asserts the
# image it just pushed with the code that rehearsed it. Needs a Docker daemon and,
# for the architecture that is not the host's, the runner's binfmt registrations
# (`docker/setup-qemu-action`): `--platform` is explicit because a manifest list
# otherwise resolves to the host's architecture and the second half of the proof
# would quietly be the first half twice.
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

image="${1:?usage: assert-image-page.sh <image-ref> <version> [port]}"
version="${2:?usage: assert-image-page.sh <image-ref> <version> [port]}"
port="${3:-18082}"

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}

for tool in docker curl node; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "assert-image-page.sh needs $tool, which this host does not have" >&2
        exit 2
    fi
done

# The hardening the run must carry, as in the smoke: a read-only root filesystem,
# every capability dropped, no-new-privileges, and nothing mounted.
hardening=(--read-only --cap-drop ALL --security-opt no-new-privileges:true)

cleanup() {
    [ -z "$name" ] || docker rm -f "$name" >/dev/null 2>&1 || true
}
name=""
trap cleanup EXIT

for arch in amd64 arm64; do
    name="page-readback-$arch-$PPID-$$"
    echo "=== linux/$arch: the image runs, and it is the version it is tagged with ==="
    docker run --detach --name "$name" --platform "linux/$arch" "${hardening[@]}" \
        --publish "127.0.0.1:$port:8080" \
        "$image"
    label="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$name")"
    [ "$label" = "$version" ] || fail "linux/$arch carries version label '$label', want '$version'"
    echo "label OK on linux/$arch: $label"
    scripts/check-page.sh "http://127.0.0.1:$port" || {
        docker logs "$name" >&2 || true
        exit 1
    }
    docker rm -f "$name" >/dev/null
    name=""
    echo "read-back OK on linux/$arch"
done

echo "read-back OK: $image serves the page on every architecture it publishes, as version $version"
