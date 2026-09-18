/**
 * The room's listing as a tree, for the page's file tree.
 *
 * A listing carries files and no directory entry at all (`PROTOCOL.md` §5): `src/main.rs`
 * implies a `src`, and that implication is a rendering decision of the receiver's. The
 * editor clients render it on disk — a join fills the window's folder, so the Explorer's
 * own tree draws the directories — while this page has no disk and must synthesize them.
 * The helper lived in the shared bridge until the VS Code client stopped needing it; it
 * belongs to the adapter that still renders a tree.
 */

import { isGrantedPath } from '../bridge/index.ts';

/** One entry of a tree derived from a listing. Directories are synthesized, never carried. */
export interface GrantChild {
  /** The last segment, which is what a tree draws. */
  name: string;
  /** The workspace-relative path, which is what opening it addresses. */
  path: string;
  directory: boolean;
}

/**
 * The immediate children of `directory` in a listing, derived by splitting the paths.
 *
 * Directories come first and each group is ordered by code unit, which is how a file tree
 * is read.
 */
export function grantChildren(
  paths: Iterable<string>,
  directory = '',
): GrantChild[] {
  const prefix = directory === '' ? '' : `${directory}/`;
  const byName = new Map<string, GrantChild>();
  for (const path of paths) {
    // A listing that reached this client passed receipt validation, and one the host
    // wrote passed the publish rule; neither is trusted here, because a tree row — and
    // the URI opening it mints — is drawn from whatever this was handed.
    if (!isGrantedPath(path)) {
      continue;
    }
    if (!path.startsWith(prefix) || path === directory) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    if (name === '') {
      continue;
    }
    const child = byName.get(name);
    if (child === undefined) {
      byName.set(name, { name, path: `${prefix}${name}`, directory: slash !== -1 });
    } else if (slash !== -1) {
      // A path that is both a directory and a file is a tree entry either way; the
      // directory is the one that can be gone into.
      child.directory = true;
    }
  }
  return [...byName.values()].sort((left, right) => {
    if (left.directory !== right.directory) {
      return left.directory ? -1 : 1;
    }
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}
