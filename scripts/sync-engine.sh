#!/usr/bin/env bash
#
# `src/engine` and `src/bridge` are copies, never authored here. The canonical copies
# live in the VS Code client (`selvage-protocol/vscode_client`, its `src/engine` and
# `src/bridge`): the engine speaks the wire and knows no editor, so this client drives
# the same code rather than writing it a second time.
#
# Upstream SHA this copy matches: 700a59e (vscode_client feat/host-version, 2026-09-23).
# After re-running this script, update the SHA above to the source checkout's HEAD.
#
#   scripts/sync-engine.sh [path-to-vscode_client-checkout]
#
# The default source is the sibling checkout `../vscode_client`. The script copies and
# then reports the difference, so a run either brings the copies into agreement or says
# what it could not.
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${1:-"$here/../vscode_client"}"

for part in engine bridge; do
  if [[ ! -d "$source_dir/src/$part" ]]; then
    printf 'no src/%s in %s: pass the path to a vscode_client checkout\n' "$part" "$source_dir" >&2
    exit 1
  fi
done

for part in engine bridge; do
  mkdir -p "$here/src/$part"
  cp -a "$source_dir/src/$part/." "$here/src/$part/"

  # A module the source has retired must go too, or the copy drifts by addition.
  while IFS= read -r file; do
    [[ -e "$source_dir/src/${file#src/}" ]] || rm -- "$here/$file"
  done < <(cd "$here" && find "src/$part" -type f)
done
find "$here/src/engine" "$here/src/bridge" -mindepth 1 -type d -empty -delete

status=0
for part in engine bridge; do
  if ! diff -r "$source_dir/src/$part" "$here/src/$part"; then
    printf 'src/%s differs from %s/src/%s\n' "$part" "$source_dir" "$part" >&2
    status=1
  fi
done
if [[ $status -eq 0 ]]; then
  printf 'src/{engine,bridge} match %s/src (HEAD %s)\n' "$source_dir" "$(git -C "$source_dir" rev-parse --short HEAD 2>/dev/null || printf 'unknown')"
fi
exit "$status"
