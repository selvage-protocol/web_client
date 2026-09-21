/**
 * The pre-join helpers: what the join card asks, and what it remembers.
 *
 * An invite link is the page the room's own server serves, so the card asks one
 * thing, the display name: the link in the address bar or pasted into the box
 * brings its room, its token and its server with it. A bare page open has no
 * link, so the card asks for one (either a page link or a wire invite). Nothing
 * here touches the DOM; `main.ts` wires it to the card.
 */

import { MAX_DISPLAY_NAME_UNITS, parseSessionUrl } from '../engine/index.ts';

import { parsePageLink } from './share.ts';
import { linkServerBase, serverBaseOf } from './servers.ts';

export { MAX_DISPLAY_NAME_UNITS };

/** The only key the page keeps: the last name that joined, for prefill. */
export const DISPLAY_NAME_KEY = 'selvage.displayName';

/**
 * The name that goes on the wire, or why it cannot. The bound is the
 * protocol's — at most 32 UTF-16 code units, counted the way the room
 * charges (`String.length`, so an astral character costs two) — refused,
 * never shortened, the desktop rule.
 */
export function validateDisplayName(raw: string): string {
  const name = raw.trim();
  if (name === '') {
    throw new Error('Type the name other participants will see.');
  }
  if (name.length > MAX_DISPLAY_NAME_UNITS) {
    throw new Error(
      `That name is ${name.length} characters and the room allows ${MAX_DISPLAY_NAME_UNITS}. Shorten it to join.`,
    );
  }
  return name;
}

/** Where a join goes: the server, the room, and its token. */
export interface JoinTarget {
  base: string;
  room: string;
  token: string;
}

/**
 * Normalises a pasted wire invite for the engine's raw `?`/`&` split: a
 * `#fragment` is dropped and a literal `?` past the first becomes `&`, so
 * neither glues into the token. Invite values are percent-encoded, so a
 * literal `?` or `#` can never be legitimate room/token data.
 */
export function normalizeWireInvite(text: string): string {
  const unfragmented = text.split('#', 1)[0] ?? text;
  const at = unfragmented.indexOf('?');
  if (at === -1) {
    return unfragmented;
  }
  return `${unfragmented.slice(0, at + 1)}${unfragmented.slice(at + 1).replace(/\?/g, '&')}`;
}

/**
 * What a join reads from the address bar. The share link the host sent wins
 * while it is the way in; once a room closes, that link names a room that is
 * gone, so the bar contributes nothing and the fresh link pasted on the card
 * is what lands. Without this the rejoin would retry the dead room and fail.
 */
export function addressBarInvite(isTheInvite: boolean, search: URLSearchParams): URLSearchParams {
  return isTheInvite ? search : new URLSearchParams();
}

/**
 * Works out where to join from the address bar, falling back to a pasted
 * link when the page opened bare. A link in the address bar wins: it is the
 * share the host sent. Throws in the card's own plain words.
 *
 * `search` must already carry param semantics (`pageQueryParams` in
 * `share.ts` reads the address bar that way); pasted wire invites are
 * normalised here. The server is the link's own origin — the page the room's
 * server serves *is* the address the guest dials — so nothing in the query
 * names one: `pageAddress` is this page's own address, and a link that names
 * another server makes the guest talk to that one instead. Only a `ws://`
 * hand-over's base reaches the socket from the link's own text, and only the
 * schemes `linkServerBase` admits.
 */
export function resolveJoin(
  search: URLSearchParams,
  pasted: string,
  pageAddress: string,
): JoinTarget {
  const room = (search.get('room') ?? '').trim();
  const token = (search.get('token') ?? '').trim();
  if (room !== '' && token !== '') {
    return { base: serverOfPage(pageAddress), room, token };
  }
  const text = pasted.trim();
  if (text !== '') {
    const page = parsePageLink(text);
    if (page !== undefined) {
      return { base: serverOfPage(page.origin), room: page.room, token: page.token };
    }
    // The engine splits its invite on the raw `?` and `&`, so a fragment or
    // an appended second `?` would glue into the token: normalise first.
    const parsed = parseSessionUrl(normalizeWireInvite(text));
    if (
      parsed !== undefined &&
      parsed.join.room !== undefined &&
      parsed.join.token !== undefined
    ) {
      return { base: serverOfWire(parsed.base), room: parsed.join.room, token: parsed.join.token };
    }
    throw new Error('That invite link does not name a session. Paste the whole link.');
  }
  throw new Error('Paste an invite link to join.');
}

/**
 * The server a page address names, over the socket's scheme.
 *
 * A page link's own address is the server, and it needs no bound before it is
 * used: `serverBaseOf` takes the host and the path and nothing else, so what
 * the page reads `<server>/meta` from and opens its socket at cannot be an
 * address the link does not read as naming. An address that names no page of
 * either scheme — a `file://` page, which no server serves — is refused in the
 * card's words, because there is nothing to derive a room's server from.
 */
function serverOfPage(pageAddress: string): string {
  const base = serverBaseOf(pageAddress);
  if (base === '') {
    throw new Error('This page names no server to join. Open the link the host sent you.');
  }
  return base;
}

/**
 * The server a `ws://` invite names, or the card's own refusal. Its base comes
 * from whoever sent the link and is read as a request address, so it is
 * bounded — see `linkServerBase`; the guest's browser is what would have made
 * the request.
 */
function serverOfWire(raw: string): string {
  const base = linkServerBase(raw);
  if (base === undefined) {
    throw new Error('That invite link names a server this page cannot reach. Ask the host for a fresh link.');
  }
  return base;
}

/** The last name that joined, for prefill — localStorage only, never the wire. */
export function loadDisplayName(storage: Pick<Storage, 'getItem'>): string {  try {
    return storage.getItem(DISPLAY_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Remembers a joined name for prefill. A storage that refuses just skips it. */
export function saveDisplayName(storage: Pick<Storage, 'setItem'>, name: string): void {
  try {
    storage.setItem(DISPLAY_NAME_KEY, name);
  } catch {
    // Private mode and the like: the name joined, it simply was not kept.
  }
}

/**
 * A join attempted before the page finishes loading (S2, 2026-09-18). The
 * old code ran the join straight into the still-arriving editor stack and
 * failed it with `the page did not finish loading — reload the page and
 * retry`. The gate holds the attempt instead: one queued join at most, run
 * once the `load` event fires, while the card reads `Joining…` throughout.
 * A second submit while queued or running is a duplicate, never a second
 * join; a refused join releases the gate so the guest can retry.
 */
export interface JoinGate {
  /**
   * Asks to start `begin`. Returns `started` when it ran now, `queued` when
   * it will run at load, `duplicate` when a join is already queued/running.
   */
  request(begin: () => void): 'started' | 'queued' | 'duplicate';
  /** Hands the card back after a failure, so a retry may start. */
  release(): void;
}

export function createJoinGate(
  isLoaded: () => boolean,
  whenLoaded: (onLoad: () => void) => void,
): JoinGate {
  let settled = false;
  return {
    request(begin: () => void): 'started' | 'queued' | 'duplicate' {
      if (settled) {
        return 'duplicate';
      }
      settled = true;
      if (isLoaded()) {
        begin();
        return 'started';
      }
      whenLoaded(begin);
      return 'queued';
    },
    release(): void {
      settled = false;
    },
  };
}

/**
 * Enter in a card field joins: the keydown default is prevented, so no
 * implicit submit follows — exactly one attempt, in every browser, instead
 * of relying on implicit-submission quirks. Repeats never re-fire.
 */
export function joinOnEnter(
  event: { key: string; repeat: boolean; preventDefault(): void },
  attempt: () => void,
): void {
  if (event.key !== 'Enter' || event.repeat) {
    return;
  }
  event.preventDefault();
  attempt();
}

/**
 * The pre-join card's live controls, addressed structurally so the wiring stays
 * testable without a DOM. The card shell itself is inline HTML: it paints before
 * the bundle arrives, and this wiring only flips `hidden` on the variant the
 * address bar calls for — never a re-render, so nothing typed is lost.
 */
export interface JoinCardElements {
  inviteWrap: { hidden: boolean };
  inviteInput: { value: string };
  nameInput: { value: string };
}

/** Which field the card should offer focus to: the first empty question. */
export type JoinFocusTarget = 'name' | 'invite';

/**
 * Wires the pre-join card for `search` without touching the editor stack.
 *
 * The shell's inline script has already made both decisions once — it runs
 * before the first paint, so the card never grows a paste box or a name under
 * the reader — and this is the same wiring taking over with the same answer.
 *
 * Two guarantees the slow-load defect taught: the remembered name prefills
 * only an untouched field — anything typed before the bundle arrives stays —
 * and the caller's focus decision lands past first paint, never stealing a
 * field the guest already typed into. Returns where focus belongs.
 *
 * The card asks its one question either way: a link open needs nothing but
 * the name, a bare open shows the paste box above it.
 */
export function initJoinCard(
  elements: JoinCardElements,
  search: Pick<URLSearchParams, 'get'>,
  storage: Pick<Storage, 'getItem'>,
): JoinFocusTarget {
  const room = (search.get('room') ?? '').trim();
  const token = (search.get('token') ?? '').trim();
  const linkMode = room !== '' && token !== '';
  // Both ways, not just the bare open: the variant is one decision, and a
  // shell that painted the other one is corrected here rather than trusted.
  elements.inviteWrap.hidden = linkMode;
  // A slow first load means the guest may have typed ahead of the bundle:
  // prefill only the field they left alone.
  if (elements.nameInput.value === '') {
    elements.nameInput.value = loadDisplayName(storage);
  }
  return linkMode || elements.inviteInput.value !== '' ? 'name' : 'invite';
}

/**
 * The card in its rejoin shape, addressed the same structural way as the
 * pre-join wiring. The session is over, so the card comes back over the
 * blurred preview with one line saying what happened and the paste box open:
 * the link the address bar carried named the room that just closed, and only a
 * fresh link gets anyone in. The name is left as the guest typed it, so the
 * next join is one paste and Enter.
 */
export interface RejoinCardElements {
  join: { hidden: boolean };
  preview: { hidden: boolean };
  veil: { hidden: boolean };
  message: { hidden: boolean; textContent: string };
  error: { textContent: string };
  inviteWrap: { hidden: boolean };
  inviteInput: { value: string };
  joinButton: { disabled: boolean; textContent: string };
}

export function showRejoinCard(elements: RejoinCardElements, message: string): void {
  elements.join.hidden = false;
  elements.preview.hidden = false;
  elements.veil.hidden = false;
  elements.message.textContent = message;
  elements.message.hidden = false;
  elements.error.textContent = '';
  elements.inviteWrap.hidden = false;
  elements.inviteInput.value = '';
  elements.joinButton.disabled = false;
  elements.joinButton.textContent = 'Join';
}
