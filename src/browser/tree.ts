/**
 * The room's listing as a tree, for the page's file tree.
 *
 * A listing carries files and no directory entry at all (`PROTOCOL.md` §5): `src/main.rs`
 * implies a `src`, and that implication is a rendering decision of the receiver's. The
 * editor clients render it on disk — a join fills the window's folder, so the Explorer's
 * own tree draws the directories — while this page has no disk and must synthesize them.
 * It belongs to the adapter that still renders a tree.
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
  const root = directory('', '');
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
      const last = index === segments.length - 1;
      const known = parent.byName.get(name);
      if (known !== undefined) {
        if (!last && !known.directory) {
          // A path that is both a directory and a file is a tree entry either way; the
          // directory is the one that can be gone into. Promote the file in place so its
          // position among its siblings does not move.
          const into = directory(known.name, known.path);
          parent.byName.set(name, into);
          parent.children[parent.children.indexOf(known)] = into;
          parent = into;
        } else if (known.directory) {
          parent = known as Directory;
        }
        continue;
      }
      if (last) {
        const file: GrantChild = { name, path, directory: false };
        parent.byName.set(name, file);
        parent.children.push(file);
      } else {
        const into = directory(name, parent.path === '' ? name : `${parent.path}/${name}`);
        parent.byName.set(name, into);
        parent.children.push(into);
        parent = into;
      }
    }
  }

  const levels = new Map<string, GrantChild[]>();
  const walk = (node: Directory): void => {
    levels.set(node.path, order(node.children));
    for (const child of node.children) {
      if (child.directory) {
        walk(child as Directory);
      }
    }
  };
  walk(root);
  return levels;
}

interface Directory extends GrantChild {
  directory: true;
  children: GrantChild[];
  byName: Map<string, GrantChild>;
}

/** A directory carries the children and the names already seen under it; a file is a bare child. */
function directory(name: string, path: string): Directory {
  return { name, path, directory: true, children: [], byName: new Map() };
}

/** One level's children in the order a tree reads them. */
function order(nodes: readonly GrantChild[]): GrantChild[] {
  return [...nodes]
    .sort((left, right) => {
      if (left.directory !== right.directory) {
        return left.directory ? -1 : 1;
      }
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    })
    // A directory is the derivation's own object; the level hands back the plain child.
    .map((node) => (node.directory ? { name: node.name, path: node.path, directory: true } : node));
}
