/**
 * The pre-join helpers: what the join card asks, and what it remembers.
 *
 * A share link carries the room, its token, and the server when off the
 * default — so the card asks one thing, the display name. A bare page open
 * has no link, so the card asks for the link itself (one paste box taking
 * either a page link or a wire invite) plus the name. Nothing here touches
 * the DOM; `main.ts` wires it to the card.
 */

import { MAX_DISPLAY_NAME_UNITS, parseSessionUrl } from '../engine/index.ts';

import { parsePageLink } from './share.ts';

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
    throw new Error('type the name other participants will see');
  }
  if (name.length > MAX_DISPLAY_NAME_UNITS) {
    throw new Error(
      `that name is ${name.length} characters and the room allows ${MAX_DISPLAY_NAME_UNITS} — shorten it to join`,
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
 * Works out where to join from the address bar, falling back to a pasted
 * link when the page opened bare. A link in the address bar wins: it is the
 * share the host sent. Throws in the card's own plain words.
 *
 * `search` must already carry param semantics (`pageQueryParams` in
 * `share.ts` reads the address bar that way); pasted wire invites are
 * normalised here.
 */
export function resolveJoin(
  search: URLSearchParams,
  pasted: string,
  defaultServer: string,
): JoinTarget {
  const room = (search.get('room') ?? '').trim();
  const token = (search.get('token') ?? '').trim();
  if (room !== '' && token !== '') {
    const server = (search.get('server') ?? '').trim();
    return { base: server === '' ? defaultServer : server, room, token };
  }
  const text = pasted.trim();
  if (text !== '') {
    const page = parsePageLink(text);
    if (page !== undefined) {
      return {
        base: page.server === undefined ? defaultServer : page.server,
        room: page.room,
        token: page.token,
      };
    }
    // The engine splits its invite on the raw `?` and `&`, so a fragment or
    // an appended second `?` would glue into the token: normalise first.
    const parsed = parseSessionUrl(normalizeWireInvite(text));
    if (
      parsed !== undefined &&
      parsed.join.room !== undefined &&
      parsed.join.token !== undefined
    ) {
      return { base: parsed.base, room: parsed.join.room, token: parsed.join.token };
    }
    throw new Error('that invite link does not name a session — paste the whole link');
  }
  throw new Error('paste an invite link to join');
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
  joinRoomline: { hidden: boolean };
  inviteWrap: { hidden: boolean };
  inviteInput: { value: string };
  nameInput: { value: string };
}

/** Which field the card should offer focus to: the first empty question. */
export type JoinFocusTarget = 'name' | 'invite';

/**
 * Wires the pre-join card for `search` without touching the editor stack.
 *
 * Two guarantees the slow-load defect taught: the remembered name prefills
 * only an untouched field — anything typed before the bundle arrives stays —
 * and the caller's focus decision lands past first paint, never stealing a
 * field the guest already typed into. Returns where focus belongs.
 */
export function initJoinCard(
  elements: JoinCardElements,
  search: Pick<URLSearchParams, 'get'>,
  storage: Pick<Storage, 'getItem'>,
): JoinFocusTarget {
  const room = (search.get('room') ?? '').trim();
  const token = (search.get('token') ?? '').trim();
  const linkMode = room !== '' && token !== '';
  if (linkMode) {
    elements.joinRoomline.hidden = false;
  } else {
    elements.inviteWrap.hidden = false;
  }
  // A slow first load means the guest may have typed ahead of the bundle:
  // prefill only the field they left alone.
  if (elements.nameInput.value === '') {
    elements.nameInput.value = loadDisplayName(storage);
  }
  return linkMode || elements.inviteInput.value !== '' ? 'name' : 'invite';
}
