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

import type { ServerRead } from './meta-read.ts';

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
 *
 * Two facts reach it, and neither of them is "`/meta` did not answer": an origin that answered
 * with something that is not a Selvage `/meta` (a static host, another JSON API, a page) and a
 * page whose own address names no server at all (a `file://` open). A read that timed out is the
 * third thing, and it is not this sentence — see `HOST_UNREAD_NOTE`.
 */
export const HOST_NEEDS_THE_SERVERS_PAGE =
  'This page was not served by a Selvage server, so there is nothing here to start a room on. Open the server\u2019s own page \u2014 the address a share link points at \u2014 to start a room from a browser.';

/**
 * The warning beside the action where `/meta` had not answered by the time the card was built.
 *
 * The read that decides the *offer* is not the read that decides the *mint*: `/meta` is advisory
 * (`PROTOCOL.md` §2), so a deadline that passed says nothing about the server — a page whose own
 * address was slow, cold, or behind a proxy that hiccupped is still the server's own page. The
 * person is told what was not read and what the click does about it, and never the sentence that
 * belongs to a page that is not the server's.
 */
export const HOST_UNREAD_NOTE =
  'This page\u2019s own address has not answered /meta, so which wire versions it seats is not known yet \u2014 starting a session here asks it again and the handshake reports the truth. ' +
  HOST_TAB_WARNING;

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
 * after a click that was never going to work. Each state carries the note the card reads beside
 * the action, or in its place.
 */
export type HostAvailability =
  /** The page's own origin is a Selvage server, and this page can host on what it seats. */
  | { kind: 'offered'; note: string }
  /** Offered, and `/meta` had not answered: the note says what was not read and what the click does. */
  | { kind: 'unchecked'; note: string }
  /** No action: the note is the sentence that stands where it would be. */
  | { kind: 'explained'; note: string };

/**
 * The decision, from the facts it rests on.
 *
 * The picker comes first either way: it is the one the browser owns, and a page that cannot hand
 * over a folder is told so before anything is read. Then what this page's own origin said about
 * itself, and then what the server seats with this page's pin laid over it.
 */
export function hostAvailability(options: {
  /** Whether this browser has a directory picker at all. */
  picker: boolean;
  /** What the page's own origin answered when this card asked it (`meta-read.ts`). */
  read: ServerRead;
  /** The version the server seats and this page's pin settle on, or the refusal standing there. */
  decision: HostDecision;
}): HostAvailability {
  if (!options.picker) {
    return { kind: 'explained', note: HOST_NEEDS_A_BROWSER };
  }
  if (options.read.kind === 'not-a-server') {
    return { kind: 'explained', note: HOST_NEEDS_THE_SERVERS_PAGE };
  }
  if (options.read.kind === 'server' && options.decision.outcome === 'refuse') {
    return { kind: 'explained', note: hostRefusalSentence(options.decision) };
  }
  if (options.read.kind === 'no-answer') {
    return { kind: 'unchecked', note: HOST_UNREAD_NOTE };
  }
  return { kind: 'offered', note: HOST_TAB_WARNING };
}
