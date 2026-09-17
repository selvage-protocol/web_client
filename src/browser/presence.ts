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

/** Escapes text for a CSS double-quoted `content` string. */
export function escapeCssContent(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, ' ');
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


