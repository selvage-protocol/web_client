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
 * Every level of a listing's tree: the path of a directory (the empty string for the
 * root) to its immediate children.
 *
 * One pass is the point. A listing is a peer's word and can carry thousands of names, and
 * a level-at-a-time derivation re-scans the whole listing once per directory it has
 * found — work proportional to the listing times its depth, paid again on every
 * re-render of the tree. Each path is walked segment by segment here instead, so a
 * directory is derived once from the one walk that implied it.
 *
 * Directories come first and each group is ordered by code unit, which is how a file tree
 * is read.
 */
export function grantLevels(paths: Iterable<string>): Map<string, GrantChild[]> {
  const root: Level = { name: '', path: '', directory: true, children: [] };
  const byName = new Map<string, Map<string, Level>>([['', new Map()]]);
  for (const path of paths) {
    // A listing that reached this client passed receipt validation, and one the host
    // wrote passed the publish rule; neither is trusted here, because a tree row — and
    // the URI opening it mints — is drawn from whatever this was handed.
    if (!isGrantedPath(path)) {
      continue;
    }
    const segments = path.split('/');
    let parent = root;
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index] ?? '';
      let level = byName.get(parent.path);
      if (level === undefined) {
        level = new Map();
        byName.set(parent.path, level);
      }
      const known = level.get(name);
      if (known !== undefined) {
        if (index < segments.length - 1) {
          // A path that is both a directory and a file is a tree entry either way; the
          // directory is the one that can be gone into.
          known.directory = true;
        }
        parent = known;
        continue;
      }
      const node: Level = {
        name,
        path: parent.path === '' ? name : `${parent.path}/${name}`,
        directory: index < segments.length - 1,
        children: [],
      };
      level.set(name, node);
      parent.children.push(node);
      parent = node;
    }
  }

  const levels = new Map<string, GrantChild[]>();
  const walk = (node: Level): void => {
    levels.set(node.path, order(node.children));
    for (const child of node.children) {
      if (child.directory) {
        walk(child);
      }
    }
  };
  walk(root);
  return levels;
}

/** One level being derived: a tree entry plus the children hung under it. */
interface Level extends GrantChild {
  children: Level[];
}

/** One level's children in the order a tree reads them, without the derivation's own field. */
function order(nodes: Level[]): GrantChild[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.directory !== right.directory) {
        return left.directory ? -1 : 1;
      }
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    })
    .map((node) => ({ name: node.name, path: node.path, directory: node.directory }));
}
