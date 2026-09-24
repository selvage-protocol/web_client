/**
 * Roster rows: who is here, glanceable. Each row carries the peer's colour
 * swatch, their name, the role the room gives them, and the two verbs — never
 * path text (where someone is reads on the grant tree, as a badge on their
 * file). The own name leads, with a you marker, the name it is seated under
 * and one control of its own to change it. The follow banner owns the one stop
 * control, so a followed row reads Following and offers nothing to press.
 *
 * The own row's edit is a field the page opens and closes, not the roster's
 * own state: the page holds it, stops re-drawing the list while it is open — a
 * presence frame every few hundred milliseconds would take the field out from
 * under the person typing in it — and re-draws when it ends.
 */

import type { Role } from '../engine/index.ts';
import { iconSpan, labelSpan } from './icons.ts';
import { rosterLabel } from './names.ts';

/**
 * Marks a verb dead and says why, returning the reason as a line the row can
 * carry. The `title` is what a pointer device reads on hover; a finger has none,
 * so the returned element is unhidden there by the shell (`#roster .why`).
 */
function dead(button: HTMLButtonElement, reason: string): HTMLElement {
  button.disabled = true;
  button.title = reason;
  const why = document.createElement('span');
  why.className = 'why';
  why.textContent = reason;
  return why;
}

export interface RosterPeer {
  peerId: string;
  displayName: string;
  role: Role;
  /** The peer's colour: the same mapping the caret wears. */
  colour: string;
  /** The room path the peer is in, when it has one open. */
  path: string | undefined;
}

/** The own-name edit, open: the page drives it, the roster draws it. */
export interface RosterRename {
  /** What the field opens with: the name this window is seated under. */
  value: string;
  /** The protocol's bound, so the field cannot offer more than the room takes. */
  maxLength: number;
  /** Enter: the name to send. The page validates and sends it. */
  commit(value: string): void;
  /** Escape, or leaving the field: nothing is sent. */
  cancel(): void;
}

export interface RosterView {
  followedPeerId: string | undefined;
  selfName: string;
  /** The swatch colour for the own row; the page passes the peer-colour mapping. */
  selfColour?: string;
  /**
   * The role the room gives this connection's own seat, which the room's peer list never
   * carries (`§13.4`): without it the one row a host alone in a room can see would not say
   * that it is the host.
   */
  selfRole?: Role;
  /** The own-name edit in progress, when one is open. */
  renaming?: RosterRename;
  onGoTo(peerId: string): void;
  onFollow(peerId: string): void;
  /** Opens the own-name edit. Absent where the page has no name to change. */
  onRename?: () => void;
}

/**
 * The rename intent's words, which both desktop clients give their command
 * (`docs/studies/client-command-parity.md` §5): the row's own control is a
 * verb, and this is what a pointer reads on it.
 */
const RENAME_LABEL = 'Set the name other participants see';

/** What the edit's two visible ways out are called, in the row's own words. */
const RENAME_SAVE_LABEL = 'Set this name';
const RENAME_CANCEL_LABEL = 'Leave the name as it is';

/**
 * What the field is called, in the words the join card already gives the same
 * question: one page, one way to ask a person what the room should call them.
 */
const NAME_FIELD_LABEL = 'The name other participants see';

/** Draws the self row plus one row per peer, replacing the list contents. */
export function renderRoster(list: HTMLElement, peers: readonly RosterPeer[], view: RosterView): void {
  list.replaceChildren();
  list.appendChild(selfRow(view));
  for (const peer of peers) {
    list.appendChild(peerRow(peer, peers, view));
  }
}

/**
 * The own row, drawn with the same anatomy as a peer row — swatch, name and
 * actions slot — so it reads as a roster member rather than a section
 * header. The two verbs stay, disabled with the reason: going to or following
 * yourself is meaningless. The third is the one thing this row can act on,
 * replacing the name with the field it is about while the edit is open: the
 * room labels the seats it lists and this connection's own is not one of them
 * (`PROTOCOL.md` §5), so the name here is the page's to keep and the page's to
 * change.
 */
function selfRow(view: RosterView): HTMLElement {
  const row = document.createElement('li');
  row.classList.add('self');
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  if (view.selfColour !== undefined) {
    swatch.style.backgroundColor = view.selfColour;
  }
  swatch.title = 'this is you';
  row.appendChild(swatch);
  const who = document.createElement('span');
  who.className = 'who';
  const rename = view.renaming;
  if (rename === undefined) {
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = view.selfName;
    who.appendChild(name);
    const you = document.createElement('span');
    you.className = 'you';
    you.textContent = 'you';
    who.appendChild(you);
    const host = view.selfRole === undefined ? undefined : hostMarker(view.selfRole);
    if (host !== undefined) {
      who.appendChild(host);
    }
  } else {
    who.appendChild(nameField(rename));
  }
  row.appendChild(who);
  const actions = document.createElement('span');
  actions.className = 'actions';
  const go = document.createElement('button');
  go.type = 'button';
  go.append(iconSpan('go'), labelSpan('Go to'));
  const whyGo = dead(go, 'This is you.');
  actions.appendChild(go);
  const follow = document.createElement('button');
  follow.type = 'button';
  follow.append(iconSpan('follow'), labelSpan('Follow'));
  const whyFollow = dead(follow, "You can't follow yourself.");
  actions.appendChild(follow);
  if (rename === undefined && view.onRename !== undefined) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.append(iconSpan('edit'), labelSpan('Rename'));
    edit.title = RENAME_LABEL;
    edit.addEventListener('click', () => view.onRename?.());
    actions.appendChild(edit);
  }
  row.append(actions, whyGo, whyFollow);
  return row;
}

/**
 * The name the field is about, and the five ways out of it.
 *
 * Enter sends and Escape cancels, as they always did; the confirm and cancel controls beside the
 * field are the visible pair for a person who does not already know the keys — a field that only
 * answers Enter is an action with no button. Clicking outside the edit dismisses it exactly as
 * Cancel does, sending nothing: a stray click must not commit a half-typed name, and the choice
 * is no longer silent because Cancel stands in the field's own row. The dismissal is what a blur
 * is, with one exception: focus moving to the edit's own two controls is not leaving it, so their
 * press is not cancelled out from under them.
 *
 * Both controls are reachable by keyboard and the field takes focus when it is drawn: the edit was
 * asked for by a press, so the person is in it already.
 */
function nameField(rename: RosterRename): HTMLElement {
  const group = document.createElement('span');
  group.className = 'rename-edit';
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'rename';
  field.value = rename.value;
  field.maxLength = rename.maxLength;
  field.setAttribute('aria-label', NAME_FIELD_LABEL);
  field.title = NAME_FIELD_LABEL;
  field.spellcheck = false;
  field.autocomplete = 'off';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'rename-save';
  save.textContent = 'Save';
  save.title = RENAME_SAVE_LABEL;
  save.addEventListener('click', () => rename.commit(field.value));
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'rename-cancel';
  cancel.textContent = 'Cancel';
  cancel.title = RENAME_CANCEL_LABEL;
  cancel.addEventListener('click', () => rename.cancel());
  // A press on the edit's own controls is not leaving the edit. `relatedTarget` says so where
  // the browser focuses the button on mousedown; where it does not (Safari reports none), the
  // press is recorded on the way down, so the button's own click still lands instead of the
  // edit being dismissed out from under it.
  let pressed = false;
  for (const control of [save, cancel]) {
    control.addEventListener('mousedown', () => {
      pressed = true;
    });
  }
  field.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      rename.commit(field.value);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      rename.cancel();
    }
  });
  field.addEventListener('blur', (event: FocusEvent) => {
    if (pressed || event.relatedTarget === save || event.relatedTarget === cancel) {
      pressed = false;
      return;
    }
    rename.cancel();
  });
  group.append(field, save, cancel);
  field.focus?.();
  return group;
}

/**
 * The marker a row wears when the room's state gives its seat a role worth
 * naming: `host`, the one peer whose connection holds the host key and whose
 * leaving puts the room into its grace (`§13.8`).
 *
 * A quiet line beside the name, in the own row's `you` shape, because the
 * roster is the page's account of who is here and the role is part of who: the
 * page's own design note has the roster draw peers with their roles, and the
 * grant tree has no room for one. It is not drawn for `guest` — the room's
 * ordinary seat, where a badge would be noise on every row but one — and
 * `viewer` is left out deliberately: it is a statement about what a peer may
 * write, the read-only state is the editor's own to show, and no row here is
 * about permission.
 */
function hostMarker(role: Role): HTMLElement | undefined {
  if (role !== 'host') {
    return undefined;
  }
  const marker = document.createElement('span');
  marker.className = 'role';
  marker.textContent = 'host';
  return marker;
}

function peerRow(peer: RosterPeer, all: readonly RosterPeer[], view: RosterView): HTMLElement {
  const row = document.createElement('li');
  row.classList.add('peer');
  if (view.followedPeerId === peer.peerId) {
    row.classList.add('following');
  }
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.backgroundColor = peer.colour;
  swatch.title = peer.colour;
  row.appendChild(swatch);
  const who = document.createElement('span');
  who.className = 'who';
  const name = document.createElement('span');
  name.className = 'name';
  // Duplicate names share the row text with a short peer id, so two
  // identical names stay two rows.
  const label = rosterLabel(peer, all);
  name.textContent = label;
  if (label !== peer.displayName) {
    name.title = peer.peerId;
  }
  who.appendChild(name);
  const host = hostMarker(peer.role);
  if (host !== undefined) {
    who.appendChild(host);
  }
  row.appendChild(who);
  const actions = document.createElement('span');
  actions.className = 'actions';
  const go = document.createElement('button');
  go.type = 'button';
  go.append(iconSpan('go'), labelSpan('Go to'));
  // Disabled, never mysteriously: the row says why, the way the self row's dead
  // actions do.
  const whyGo = peer.path === undefined ? dead(go, 'They have not opened a file yet.') : undefined;
  go.addEventListener('click', () => view.onGoTo(peer.peerId));
  actions.appendChild(go);
  const follow = document.createElement('button');
  follow.type = 'button';
  if (view.followedPeerId === peer.peerId) {
    follow.append(iconSpan('follow'), labelSpan('Following'));
    follow.disabled = true;
  } else {
    follow.append(iconSpan('follow'), labelSpan('Follow'));
    follow.addEventListener('click', () => view.onFollow(peer.peerId));
  }
  actions.appendChild(follow);
  row.appendChild(actions);
  if (whyGo !== undefined) {
    row.appendChild(whyGo);
  }
  return row;
}
