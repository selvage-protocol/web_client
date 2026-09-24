/**
 * Peer-presence badges, shared by the glyph margin and the grant tree.
 *
 * The badge is the peer's initials over their colour — the same rule the
 * desktop clients draw by — so a peer reads the same in every window.
 */

/** The bullet for a peer whose name yields no letters. */
export const ANONYMOUS_INITIALS = '•';

/** How many code points of a name a badge shows. */
export const INITIALS_LIMIT = 2;

/**
 * The initials a badge draws: the first `INITIALS_LIMIT` code points of
 * `label`, or the bullet when there are none. Iterating the string yields
 * whole code points, so a leading astral character is taken whole rather
 * than as half of a surrogate pair.
 */
export function initials(label: string): string {
  const characters = [...label].slice(0, INITIALS_LIMIT);
  return characters.length === 0 ? ANONYMOUS_INITIALS : characters.join('');
}

/**
 * One participant's presence, as far as a row's badges are concerned: the two fields the
 * badge is drawn from, so a signature can be taken without a DOM.
 */
export interface RowPresence {
  peerId: string;
  displayName: string;
  colour: string;
}

/**
 * What one row's badges look like, as a value: nothing when nobody is in the file, and a
 * per-peer run otherwise, ordered by peer id so two reads of the same room agree whatever
 * order the membership report arrived in.
 *
 * A badge draws the initials and the colour of a peer and nothing else, so this is all a
 * repaint has to compare: a peer moving to another file changes the signatures of the two
 * files it left and entered, and the rest of the tree is untouched.
 */
export function badgeSignature(row: readonly RowPresence[]): string {
  if (row.length === 0) {
    return '';
  }
  return [...row]
    .sort((left, right) => (left.peerId < right.peerId ? -1 : left.peerId > right.peerId ? 1 : 0))
    .map((peer) => `${peer.peerId}\u0000${peer.displayName}\u0000${peer.colour}`)
    .join('\u0001');
}

/**
 * The rows whose badges are not what was last drawn for them, each with the signature to
 * record: the paths a repaint is owed on, which is what a presence frame costs a tree
 * instead of a rebuild of every row it has.
 *
 * A path that has lost every occupant is reported with the empty signature, so the row
 * that was drawn is the row that gets cleared.
 */
export function changedBadgePaths(
  drawn: ReadonlyMap<string, string>,
  presence: ReadonlyMap<string, readonly RowPresence[]>,
): Map<string, string> {
  const changed = new Map<string, string>();
  for (const path of new Set([...drawn.keys(), ...presence.keys()])) {
    const signature = badgeSignature(presence.get(path) ?? []);
    if (drawn.get(path) !== signature) {
      changed.set(path, signature);
    }
  }
  return changed;
}

/**
 * One cursor per line: the lowest peer id among the cursors sharing it.
 * Glyph-margin badges on one line share a lane and would draw over one
 * another, so a shared line shows one badge; the lowest id keeps the choice
 * stable across draws and across windows.
 */
export function onePerLine<T extends { peerId: string }>(
  cursors: readonly T[],
  lineOf: (cursor: T) => number,
): Map<number, T> {
  const chosen = new Map<number, T>();
  for (const cursor of cursors) {
    const line = lineOf(cursor);
    const known = chosen.get(line);
    if (known === undefined || cursor.peerId < known.peerId) {
      chosen.set(line, cursor);
    }
  }
  return chosen;
}

/**
 * Escapes text for a CSS double-quoted `content` string.
 *
 * A quote and a backslash would end or bend the string, and a line break of any of the three
 * CSS reads as one (`\n`, `\r`, `\f`) would leave it unterminated, which drops the rule. Those,
 * and the other control characters, are written as CSS hex escapes, whose trailing space ends
 * the escape and is not painted.
 */
export function escapeCssContent(text: string): string {
  return text.replace(
    /["\\\u0000-\u001f\u007f]/g,
    (char) => `\\${char.charCodeAt(0).toString(16)} `,
  );
}

/**
 * The CSS painting one glyph-margin badge: the peer's colour behind bold
 * dark initials. The class goes on the margin lane through Monaco's
 * `glyphMarginClassName`; the `::after` carries the text because the lane
 * element itself holds none.
 */
export function badgeCss(className: string, text: string, colour: string): string {
  return (
    `.${className}::after{content:"${escapeCssContent(text)}";` +
    'display:inline-block;min-width:1.1em;text-align:center;' +
    'font:700 9px/1.5 monospace;color:#000;' +
    `background:${colour};border:1px solid #000;border-radius:3px;padding:0 1px;}`
  );
}


