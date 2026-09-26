/**
 * The pre-join helpers: what the card asks, and what it remembers.
 *
 * The card has two intents and the address bar decides which one it is. A page
 * opened with an invite — the room and its token in the query, which is the page
 * the room's own server serves — is a guest's, so it asks one thing, the display
 * name, and joins the room the address already names. A page opened bare is where
 * a room starts, so it asks the same name and starts one here, and the invite path
 * is a disclosure under it for the person who turns out to have a link. Nothing
 * here touches the DOM; `main.ts` wires it to the card.
 */

import { MAX_DISPLAY_NAME_UNITS, parseInvite, parseSessionUrl, sessionBase, sessionUrl } from '../engine/index.ts';
import type { SessionBase } from '../engine/index.ts';

import { parsePageLink } from './share.ts';
import { linkServerBase, serverBaseOf } from './servers.ts';

export { MAX_DISPLAY_NAME_UNITS };

/**
 * Which of the card's two intents this page has: the room is named by the address
 * bar, or it is a page a room starts from.
 */
export type CardIntent = 'start' | 'join';

/**
 * The address bar's answer, read the one way the card reads a link: a `room` and a
 * `token` together are the invite, and anything short of both is a bare page.
 */
export function cardIntentOf(search: Pick<URLSearchParams, 'get'>): CardIntent {
  const room = (search.get('room') ?? '').trim();
  const token = (search.get('token') ?? '').trim();
  return room !== '' && token !== '' ? 'join' : 'start';
}

/** The class the card wears in each intent; the stylesheet reads the leading action off it. */
export const CARD_START_CLASS = 'card-start';
export const CARD_JOIN_CLASS = 'card-join';

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

/**
 * Where a join goes: the server, the room, and its token. The base is read the one way the
 * engine reads a base (`sessionBase`), so what the page dials from it is what the page says
 * it dialled.
 */
export interface JoinTarget {
  base: SessionBase;
  room: string;
  token: string;
  /**
   * `§5.1`'s fragment, `#` included, or empty. It is what makes a join a `selvage/2` one: the
   * room key and the host key travel on it and nowhere else, so it is carried from whichever
   * form of the link named the room to the connection URL the engine dials.
   */
  fragment: string;
}

/**
 * What a guest meets when the invite's fragment cannot be read as `§5.1`'s two keys.
 *
 * A chat app that truncates a link cuts the fragment first: it is the longest part of the link
 * and it sits after the `#`, so the room and the token arrive whole while the keys do not. The
 * engine's own reason for that is precise and unreadable ("`h` is not a 32-byte key in the
 * fragment's encoding"), and it is kept for the console and `?debug=1`; this is the sentence the
 * card reads, in the same register as the one a dead room gets.
 */
export const INCOMPLETE_INVITE_SENTENCE =
  'That invite link is incomplete. Ask the host for a fresh link and retry.';

/**
 * Why the invite's fragment cannot be read as `§5.1`'s two keys, or `undefined` when it can.
 *
 * The check runs on the link the engine would dial — the same `sessionUrl` the join builds — so
 * what the card refuses is what the socket would refuse, before a name is typed or a socket is
 * opened. Only the fragment is decided here: `room` and `token` are the address bar's own test
 * for the card's intent (`cardIntentOf`).
 */
export function inviteShortfall(target: JoinTarget): string | undefined {
  const read = parseInvite(`${sessionUrl(target.base, target.room, target.token)}${target.fragment}`);
  return read.ok ? undefined : read.reason;
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
    // The address bar's own share link: the fragment is the part of it a version-2 room needs,
    // and `pageQueryParams` never sees it because it is not a parameter.
    return { base: serverOfPage(pageAddress), room, token, fragment: fragmentOf(pageAddress) };
  }
  const text = pasted.trim();
  if (text !== '') {
    const page = parsePageLink(text);
    if (page !== undefined) {
      return {
        base: serverOfPage(page.origin),
        room: page.room,
        token: page.token,
        fragment: page.fragment,
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
      return {
        base: serverOfWire(parsed.base),
        room: parsed.join.room,
        token: parsed.join.token,
        fragment: fragmentOf(text),
      };
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
function serverOfPage(pageAddress: string): SessionBase {
  const base = sessionBase(serverBaseOf(pageAddress));
  if (base === undefined) {
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
function serverOfWire(raw: string): SessionBase {
  const bounded = linkServerBase(raw);
  const base = bounded === undefined ? undefined : sessionBase(bounded);
  if (base === undefined) {
    throw new Error('That invite link names a server this page cannot reach. Ask the host for a fresh link.');
  }
  return base;
}

/** The `#…` a link carries, `#` included, or empty. A fragment is never query data. */
export function fragmentOf(link: string): string {
  const hash = link.indexOf('#');
  return hash === -1 ? '' : link.slice(hash);
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
 * A join attempted before the page finishes loading (S2, 2026-09-18): the
 * bundle's own code is still arriving, so the gate holds the attempt. One
 * queued join at most, run once the `load` event fires, while the card reads
 * `Joining…` throughout. A second submit while queued or running is a
 * duplicate, never a second join; a refused join releases the gate so the
 * guest can retry.
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
 * The card in one of its two intents, addressed structurally so the wiring stays
 * testable without a DOM. The card shell itself is inline HTML: it paints before
 * the bundle arrives, and this wiring only flips `hidden` and the browser's own
 * disclosure — never a re-render, so nothing typed is lost.
 */
export interface CardIntentElements {
  /** The card itself, whose class tells the stylesheet which action leads. */
  pane: { className: string };
  /** `Start a Selvage session`: the heading read on a page that starts one. */
  startHeading: { hidden: boolean };
  /** `Join a Selvage session`: the heading read on a page a link named. */
  joinHeading: { hidden: boolean };
  /** The invite path's disclosure: open is the paste box and Join being asked for. */
  invitePath: { open: boolean };
  /** The line that asks for a link, read only where there is no link to paste. */
  inviteReveal: { hidden: boolean };
  /** The paste box, hidden while the room is already named by the address. */
  inviteWrap: { hidden: boolean };
}

/** The pre-join card's live controls: its intent, and the two fields it asks in. */
export interface JoinCardElements extends CardIntentElements {
  inviteInput: { value: string };
  nameInput: { value: string };
}

/**
 * Puts the card in one of its two intents: which heading is read, which action the
 * stylesheet leads with, and what the invite path shows.
 *
 * `reveal` is a link being pasted rather than one the address bar carried, which is
 * the card's rejoin shape: the room that just ended took the address-bar link with
 * it, so the card comes back for a fresh one. It opens the invite path in the
 * intent that would otherwise keep it shut, and the paste box is the one thing it
 * shows — a room the address already names leaves nothing to paste. A person
 * opening the disclosure themselves is the browser's own doing, and is not this.
 */
export function showCardIntent(
  elements: CardIntentElements,
  intent: CardIntent,
  reveal = false,
): void {
  const join = intent === 'join';
  elements.pane.className = join ? CARD_JOIN_CLASS : CARD_START_CLASS;
  elements.startHeading.hidden = join;
  elements.joinHeading.hidden = !join;
  // The invite path is opened where the card needs it open, and never shut. On the
  // join intent it is the way in — Join lives inside it and the paste box is hidden
  // — so it is opened whatever the shell left it as; a reveal asks for the same. On
  // a start card the shell paints it shut, so an open one is the person's own click,
  // made in the window between the shell and this wiring, and shutting it would hide
  // the field they may be typing in and drop the focus they put there.
  if (join || reveal) {
    elements.invitePath.open = true;
  }
  elements.inviteReveal.hidden = join;
  elements.inviteWrap.hidden = join && !reveal;
}

/**
 * What Enter in the name field runs: the action this card leads with. The name is
 * the card's own question in either intent, so Enter is the intent's own action — the
 * start action on a bare page that can host here, and the join everywhere else. Where
 * the card cannot start a room, the invite path is the only action the page has left,
 * so Enter takes it and the join path asks for the link it needs, in its own line,
 * under the button that asked; a person told nothing by a field the card focused itself
 * has no way to guess what to do next. This is the same act a pre-bundle Enter in that
 * field is held for (`public/index.html`) and the same one it takes as soon as the
 * bundle arms.
 */
export type PrimaryAction = 'host' | 'join';

export function primaryActionOf(
  intent: CardIntent,
  hostingOffered: boolean,
): PrimaryAction {
  if (intent === 'join') {
    return 'join';
  }
  return hostingOffered ? 'host' : 'join';
}

/**
 * Wires the pre-join card for `search` without touching the editor stack, and says
 * which intent it landed in.
 *
 * The shell's inline script has already made these decisions once — it runs before
 * the first paint, so the card never grows a paste box, a heading or a name under
 * the reader — and this is the same wiring taking over with the same answer.
 *
 * One guarantee the slow-load defect taught: the remembered name prefills only an
 * untouched field, so anything typed before the bundle arrives stays. The name is
 * the card's own question in either intent — both actions need it — so the caller
 * offers focus to that field, past first paint, and never to one already typed in.
 */
export function initJoinCard(
  elements: JoinCardElements,
  search: Pick<URLSearchParams, 'get'>,
  storage: Pick<Storage, 'getItem'>,
): CardIntent {
  const intent = cardIntentOf(search);
  // Both ways, not just the bare open: the intent is one decision, and a shell that
  // painted the other one is corrected here rather than trusted.
  showCardIntent(elements, intent);
  if (elements.nameInput.value === '') {
    elements.nameInput.value = loadDisplayName(storage);
  }
  return intent;
}

/**
 * The name's own refusal, at the field it is about.
 *
 * The card's two actions both need the name, and each of them has an error line under its own
 * button — which is a screen away from where the name is asked, and said nothing about which
 * field was wrong: pressing the primary action with an empty name left focus on the button that
 * was pressed and the field unmarked, so the sentence read as the button's own failure. The
 * refusal stands beside the field now, focus goes to the field, and the field wears the
 * `aria-invalid` that says the same thing to a screen reader.
 *
 * A field is only invalid while the card is saying so: typing clears both, because the sentence
 * is about the value that was submitted and the value has changed.
 */
export interface NameField {
  /** The input the card asks the name in. */
  field: {
    setAttribute(name: string, value: string): void;
    removeAttribute?(name: string): void;
    focus?(): void;
  };
  /** The line the refusal is written in, beside the field. */
  error: { textContent: string };
}

export function showNameFailure(field: NameField, message: string): void {
  field.error.textContent = message;
  field.field.setAttribute('aria-invalid', 'true');
  field.field.focus?.();
}

export function clearNameFailure(field: NameField): void {
  field.error.textContent = '';
  if (field.field.removeAttribute !== undefined) {
    field.field.removeAttribute('aria-invalid');
    return;
  }
  field.field.setAttribute('aria-invalid', 'false');
}

/**
 * A refused join is opened before it is written: its line stands inside the invite
 * path, under Join, beside the paste box it is about, and a bare page's early submit
 * is replayed after the bundle lands with the disclosure still shut — a refusal
 * written there is one nobody can read.
 */
export interface JoinFailureTarget {
  invitePath: { open: boolean };
  joinError: { textContent: string };
}

export function showJoinFailure(target: JoinFailureTarget, message: string): void {
  target.invitePath.open = true;
  target.joinError.textContent = message;
}

/**
 * The start card, shown again once a session is over: the same card a fresh page opens on, over the
 * blurred preview. The name is left as it was typed. `message` is a short reason, or empty when the
 * person left on purpose and needs none.
 */
export interface StartAgainElements extends CardIntentElements {
  /** The card itself: it is shown again, and its class is what decides the leading action. */
  pane: { className: string; hidden: boolean };
  preview: { hidden: boolean };
  veil: { hidden: boolean };
  message: { hidden: boolean; textContent: string };
  /** The join path's own failure line, under the button that asked for the link. */
  joinError: { textContent: string };
  /** The start action's, under the button that asked for the name. */
  hostError: { textContent: string };
  inviteInput: { value: string };
  joinButton: { disabled: boolean; textContent: string };
}

export function showStartAgain(elements: StartAgainElements, message: string): void {
  showCardIntent(elements, 'start');
  elements.invitePath.open = false;
  elements.pane.hidden = false;
  elements.preview.hidden = false;
  elements.veil.hidden = false;
  elements.message.textContent = message;
  elements.message.hidden = message === '';
  elements.joinError.textContent = '';
  elements.hostError.textContent = '';
  elements.inviteInput.value = '';
  elements.joinButton.disabled = false;
  elements.joinButton.textContent = 'Join';
}
