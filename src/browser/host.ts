/**
 * Starting a room from the page: what the card offers and what a reload leaves behind.
 *
 * A page-hosted room lives in a tab, and the page's join flow is built the other way round: it
 * writes the invite link into the address bar so a reload rejoins. For a host that is exactly
 * backwards — a reload would rejoin its own room as a *guest*, with no folder and nothing to
 * serve, while the dead socket's grace ran out underneath it and the room died at the deadline
 * with nobody told. So a host never writes the link into the address bar, and it leaves a mark
 * in `sessionStorage` (the tab's own memory, gone with the tab) so the next load of this page
 * can say what happened rather than quietly offering a card.
 *
 * Reclaiming is the other honest option and it is not built: it needs the handle kept in
 * IndexedDB, a *Resume hosting* click inside the grace, and a permission re-prompt, which is
 * the first thing the study would cut (`ai_notes/docs/studies/browser-hosted-rooms.md` §9). What
 * is left is honest instead of silent: the load after a reload says what the reload cost.
 *
 * Reading a room's *version* is not part of this: there is one wire, every client speaks it, and
 * a page that can mint does.
 */

import type { ServerRead } from './meta-read.ts';

/** The tab's own memory: gone when the tab is, and shared with no other tab or origin. */
export type HostStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The key the marker lives under. */
export const HOST_MARK_KEY = 'selvage.hosting';

/** Why the host action is not offered: this browser has no directory picker. */
export const HOST_NEEDS_A_BROWSER =
  'This browser cannot hand a page a folder, so a room cannot be started from it. Chrome and Edge can; Firefox and Safari cannot. Joining a room here still works.';

/**
 * Why the host action is not offered, and what the card says instead: nothing.
 *
 * The page's rule is that the link's own origin is the server, and a host has no link, so a host
 * needs a page its server is behind. A page that answered with something else — a static host,
 * another JSON API, a page — has no room to start and no sentence worth standing where the action
 * would be: the card leads with the way in it does have, which is the invite path with `Join` as its
 * action. That this page is not a Selvage server's is not a fact the person can act on, and the join
 * attempt says what went wrong when they try.
 *
 * Two facts reach it, and neither of them is "`/meta` did not answer": an origin that answered with
 * something that is not a Selvage `/meta`, and a page whose own address names no server at all (a
 * `file://` open). A read that timed out is the third thing, and it keeps the offer with a note
 * saying what was not read (`HOST_UNREAD_NOTE`).
 */
/**
 * The warning beside the action where `/meta` had not answered by the time the card was built.
 *
 * The read that decides the *offer* is not the read that decides the *mint*: `/meta` is advisory
 * (`PROTOCOL.md` §2), so a deadline that passed says nothing about the server — a page whose own
 * address was slow, cold, or behind a proxy that hiccupped is still the server's own page. The
 * person is told what was not read and what the click does about it, and never the sentence that
 * belongs to a page that is not the server's.
 */
export function hostUnreadNote(): string {
  return 'This page\u2019s own address has not answered /meta, so whether it is a Selvage server is not known yet \u2014 starting a session here asks it again and the handshake reports the truth.';
}

export const HOST_UNREAD_NOTE = hostUnreadNote();

/** Marks this tab as hosting `roomId`, so a reload can say what it cost. */
export function markHosting(storage: HostStorage, roomId: string): void {
  try {
    storage.setItem(HOST_MARK_KEY, roomId);
  } catch {
    // Private mode and the like: the room works, the reload just has no sentence to add.
  }
}

/** The mark a host leaves, cleared once it has been read. */
export function clearHostingMark(storage: HostStorage): void {
  try {
    storage.removeItem(HOST_MARK_KEY);
  } catch {
    // Nothing was stored; nothing to clear.
  }
}

/**
 * What the load after a reload says, and the mark is taken: the room this tab was hosting ended
 * when the tab went, and the person is told that rather than left with a card that looks like
 * the last one.
 *
 * The mark is a tab's own memory, so this reads `true` only where a host reloaded or reopened
 * the page in its own tab; a fresh tab, a new window or another device has nothing to read, and
 * a person who never hosted sees nothing at all.
 */
export function takeHostingNotice(storage: HostStorage): string | undefined {
  let marked: boolean;
  try {
    marked = storage.getItem(HOST_MARK_KEY) !== null;
  } catch {
    return undefined;
  }
  if (!marked) {
    return undefined;
  }
  clearHostingMark(storage);
  return hostingOverSentence();
}

/**
 * The sentence for a room this tab was hosting and is not any more: what the reload cost, and the
 * one act that starts another.
 *
 * The page-hosted shape is not explained to this reader — they reloaded their own tab, and the
 * card in front of them is the explanation — and the guests' countdown is said where it runs rather
 * than to a host who is no longer in the room (`wireSessionNote`). What the reload cost is the room
 * and its invite link, and no more than the keystrokes still inside the settle: everything else was
 * written to the folder, which is what the sentence says rather than the old claim that nothing was.
 */
export function hostingOverSentence(): string {
  return 'Reloading ended the room this tab was hosting; the invite link is dead, everything settled is already in your folder, and pick the folder again to start another.';
}

/**
 * Whether the card may offer to start a room, decided before the button is shown rather than
 * after a click that was never going to work. An offered card carries no note — the action is the
 * whole of what it says — and a state that cannot act carries the sentence that stands in the
 * action's place.
 */
export type HostAvailability =
  /** The page's own origin is a Selvage server, and this page can host on what it seats. */
  | { kind: 'offered' }
  /** Offered, and `/meta` had not answered: the note says what was not read and what the click does. */
  | { kind: 'unchecked'; note: string }
  /** No action: the note is the sentence that stands where it would be. */
  | { kind: 'explained'; note: string }
  /**
   * No action and nothing to say: a page that is not a Selvage server's own. The card leads with the
   * way in it has, and no sentence stands where the action would have been.
   */
  | { kind: 'silent' };

/**
 * The decision, from the facts it rests on.
 *
 * The picker comes first either way: it is the one the browser owns, and a page that cannot hand
 * over a folder is told so before anything is read. Then what this page's own origin said about
 * itself.
 */
export function hostAvailability(options: {
  /** Whether this browser has a directory picker at all. */
  picker: boolean;
  /** What the page's own origin answered when this card asked it (`meta-read.ts`). */
  read: ServerRead;
}): HostAvailability {
  if (!options.picker) {
    return { kind: 'explained', note: HOST_NEEDS_A_BROWSER };
  }
  if (options.read.kind === 'not-a-server') {
    return { kind: 'silent' };
  }
  if (options.read.kind === 'no-answer') {
    return { kind: 'unchecked', note: hostUnreadNote() };
  }
  return { kind: 'offered' };
}
