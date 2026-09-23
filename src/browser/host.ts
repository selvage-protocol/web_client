/**
 * Starting a room from the page: what the card offers, what it warns about, and what a reload
 * leaves behind.
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
 * is left is honest instead of silent: the warning is on the card before the click, and the
 * load after a reload says what the reload cost.
 *
 * A room's *version* is the server's to seat and this page's to pin (`PROTOCOL.md` §2, §10), which
 * is the other thing the card has to say before a click: a page that cannot mint at a version the
 * server seats gets that sentence here, where the control would be, rather than a button whose
 * only outcome is a refusal.
 */

import type { HostDecision } from '../engine/index.ts';

/** The refusal half of a hosting decision: the room was not started, and here is why. */
export type HostRefusal = Extract<HostDecision, { outcome: 'refuse' }>;

/** The tab's own memory: gone when the tab is, and shared with no other tab or origin. */
export type HostStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The key the marker lives under. */
export const HOST_MARK_KEY = 'selvage.hosting';

/**
 * The warning the card carries beside the host action, before the click.
 *
 * The countdown is the room's own grace (`DESIGN.md` §4.4), which the server states and a
 * desktop host has the same, so the sentence names the shape and not a number that would go
 * stale.
 */
export const HOST_TAB_WARNING =
  'This tab is the host. Close or reload it and the room ends: whoever is in it keeps editing while a short countdown runs, and then the room closes and nothing in it is saved.';

/** Why the host action is not offered: this browser has no directory picker. */
export const HOST_NEEDS_A_BROWSER =
  'This browser cannot hand a page a folder, so a room cannot be started from it. Chrome and Edge can; Firefox and Safari cannot. Joining a room here still works.';

/**
 * Why the host action is not offered: this page is not the server's own page.
 *
 * The page's rule is that the link's own origin is the server, and a host has no link, so a host
 * needs a page its server is behind. The two-origin deployment whose agreement with the
 * one-address invite rule is an open item therefore gets a sentence rather than a guess.
 */
export const HOST_NEEDS_THE_SERVERS_PAGE =
  'This page was not served by a Selvage server, so there is nothing here to start a room on. Open the server\u2019s own page \u2014 the address a share link points at \u2014 to start a room from a browser.';

/**
 * Why a room was not started: this page cannot mint at a version the server seats, and the choice
 * is refused rather than fallen back from (`PROTOCOL.md` §2, §10).
 *
 * The versions are `/meta`'s own words, so the sentence reports what the server said rather than a
 * reading of it, and the pin is named where the pin is the reason: a pin is taken off the address
 * the same way it was put there. Both refusals offer the same way out, because a person told no has
 * to be able to ask for something else.
 */
export function hostRefusalSentence(refusal: HostRefusal): string {
  const offered = refusal.offered.length === 0 ? 'nothing' : refusal.offered.join(', ');
  if (refusal.reason === 'pin-not-seated') {
    return `This page is pinned to ${refusal.pin}, and this server does not seat it: its /meta offers ${offered}. The room was not started and the pin was not fallen back from \u2014 take ?wire off the address to let the server decide, or pin the version it does seat.`;
  }
  return `This server does not seat selvage/2, the encrypted wire: its /meta offers ${offered}. A room started here would be one the server can read, so none was started \u2014 pin this page to what the server does seat (?wire=1) if a room the server can read is what you want.`;
}

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

/** The sentence for a room this tab was hosting and is not any more. */
export function hostingOverSentence(): string {
  return 'This tab was hosting a room, and it is not any more: a room started from a page lives in its tab, so reloading ended it. The people in it had a short countdown to keep editing, and nothing in it was written to the folder. Pick the folder again to start another.';
}

/**
 * Whether the card may offer to start a room, decided before the button is shown rather than
 * after a click that was never going to work.
 */
export type HostAvailability =
  /** The page's own origin is a Selvage server and this browser can hand over a folder. */
  | { kind: 'offered' }
  /** A sentence instead of a control, and the reason is in it. */
  | { kind: 'explained'; sentence: string };

/**
 * The decision, from the three facts it rests on.
 *
 * The picker comes first either way: it is the one the browser owns, and a page that cannot hand
 * over a folder is told so before anything is read. Then the page's own origin, and then what the
 * server said about versions with this page's pin laid over it.
 */
export function hostAvailability(options: {
  /** Whether this browser has a directory picker at all. */
  picker: boolean;
  /** Whether the page's own origin answered `/meta` as a Selvage server. */
  serverHere: boolean;
  /** The version the server seats and this page's pin settle on, or the refusal standing there. */
  decision: HostDecision;
}): HostAvailability {
  if (!options.picker) {
    return { kind: 'explained', sentence: HOST_NEEDS_A_BROWSER };
  }
  if (!options.serverHere) {
    return { kind: 'explained', sentence: HOST_NEEDS_THE_SERVERS_PAGE };
  }
  if (options.decision.outcome === 'refuse') {
    return { kind: 'explained', sentence: hostRefusalSentence(options.decision) };
  }
  return { kind: 'offered' };
}
