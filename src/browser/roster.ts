/**
 * Roster rows: who is here, glanceable. Each row carries the peer's colour
 * swatch, their name, the role the room gives them, and the two verbs — never
 * path text (where someone is reads on the grant tree, as a badge on their
 * file). The own row leads, marked only by the one control that changes this
 * connection's own name, and a host wears the crown. Follow is a toggle, so the
 * row a window is following reads `Following` and pressing it stops, exactly as
 * the file strip's own Stop does: one state, reachable from either side.
 *
 * The own row's edit is a field the page opens and closes, not the roster's
 * own state: the page holds it, stops re-drawing the list while it is open — a
 * presence frame every few hundred milliseconds would take the field out from
 * under the person typing in it — and re-draws when it ends.
 */

import type { Role } from '../engine/index.ts';
import { iconSpan, labelSpan } from './icons.ts';
import { rosterLabel } from './names.ts';

/** A verb's own words, in a span the narrow panel can hide while the tooltip keeps them. */
function verbLabel(text: string): HTMLSpanElement {
  const span = labelSpan(text);
  span.className = 'label';
  return span;
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
  /**
   * The sentence a go-to was refused with, and the row it is about.
   *
   * A go-to refusal is a race — the peer closed the file, or the caret does not resolve here — and
   * the row that was pressed is the one place the answer belongs. It is not a state: the page takes
   * it down after its own stand and re-draws (`main.ts`).
   */
  goToRefusal?: { peerId: string; text: string };
  onGoTo(peerId: string): void;
  onFollow(peerId: string): void;
  /** The press on the row already following: the toggle's own off. */
  onStopFollow(peerId: string): void;
  /** Opens the own-name edit. Absent where the page has no name to change. */
  onRename?: () => void;
}

/**
 * The rename intent's words, which both desktop clients give their command
 * (`docs/studies/client-command-parity.md` §5): the row's own control is a
 * verb, and this is what a pointer reads on it.
 */
const RENAME_LABEL = 'Set the name other participants see';

/**
 * What a pressed toggle does when it is pressed, in the desktop clients' own words
 * (`vscode_client/test/vocabulary.test.ts`, carried by the parity study). The button's name is
 * the state it is in — `Following` — so the act is what a pointer reads in the tooltip.
 */
const STOP_FOLLOW_LABEL = 'Stop following';

/**
 * What the edit's two visible ways out are called, in the row's own words.
 *
 * The controls are the tree's ✓ and ✕ and carry no text of their own, so this is what a screen
 * reader reads and what a pointer finds in the tooltip: a glyph the reader has to guess at is a
 * control only the people who wrote the page can use.
 */
const RENAME_SAVE_LABEL = 'Set this name';
const RENAME_CANCEL_LABEL = 'Leave the name as it is';

/**
 * What the field is called. It never reaches a pointer — the row already says whose name this is
 * — but a form field needs a name a screen reader can read it by, and this is the desktop clients'
 * own words for the intent (`docs/studies/client-command-parity.md` §5, "Display name, set").
 * The card asks the same question in its own two words (`Your name`): it is the first thing a
 * person meets here, and they have not joined yet when they type it.
 */
const NAME_FIELD_LABEL = 'The name other participants see';

/**
 * Draws the self row plus one row per peer, replacing the list contents.
 *
 * A room nobody else is in draws the self row and nothing else. The `alone` row that stood under
 * it said `No one else yet.` — which the row above already says by being one row — and pointed at
 * `Copy invite link` in the bar, a control the bar itself carries and a person can see. A line
 * that repeats the list and points at visible furniture is two answers to no question.
 */
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
  // The swatch is the row's colour and nothing more: `(you)` beside it was words for the one row
  // whose identity nobody has to be told — it is the row with the control that changes this
  // connection's own name, and the only one that has it.
  row.appendChild(swatch);
  const who = document.createElement('span');
  who.className = 'who';
  const rename = view.renaming;
  if (rename === undefined) {
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = view.selfName;
    who.appendChild(name);
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
  // One control, and it is the one this row can act on. A Go to and a Follow that can never work
  // — this is the person looking, and nobody follows themselves — were two dead verbs and two lines
  // explaining why: four elements saying one thing the row's own name already says.
  if (rename === undefined && view.onRename !== undefined) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.append(iconSpan('edit'), verbLabel('Rename'));
    edit.title = RENAME_LABEL;
    edit.setAttribute('aria-label', RENAME_LABEL);
    edit.addEventListener('click', () => view.onRename?.());
    actions.appendChild(edit);
  }
  row.append(actions);
  return row;
}

/**
 * The name the field is about, and the five ways out of it.
 *
 * Enter sends and Escape cancels, as they always did; the ✓ and ✕ beside the field are the visible
 * pair for a person who does not already know the keys — a field that only answers Enter is an
 * action with no button. They are the tree's create row's own pair, down to the glyphs, because
 * they are the same two answers to the same question: keep this, or drop it. What is new here is
 * the size a finger gets: the glyph is 27 px wide, and on touch both are lifted to the 44 px floor
 * with room between them, where a miss on a file row's pair would otherwise open the file under
 * the fingertip. Clicking outside the edit dismisses it exactly as
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
  save.append(iconSpan('check'));
  save.title = RENAME_SAVE_LABEL;
  save.setAttribute('aria-label', RENAME_SAVE_LABEL);
  save.addEventListener('click', () => rename.commit(field.value));
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'rename-cancel';
  cancel.append(iconSpan('close'));
  cancel.title = RENAME_CANCEL_LABEL;
  cancel.setAttribute('aria-label', RENAME_CANCEL_LABEL);
  cancel.addEventListener('click', () => rename.cancel());
  // Leaving the edit is a `focusout` on the whole group, not a `blur` on the field: focus can
  // move from the field to Save or Cancel and only then outside, and a listener on the field
  // alone would miss that and leave the edit open. Focus moving between the edit's own parts is
  // not leaving it; a press on Save or Cancel is recorded on the way down as well, because a
  // browser that does not focus a button on mousedown (Safari) reports no `relatedTarget` and
  // the button's own click must still land rather than be cancelled out from under it. Anything
  // else dismisses exactly as Cancel does.
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
  group.addEventListener('focusout', (event: FocusEvent) => {
    if (
      pressed ||
      event.relatedTarget === field ||
      event.relatedTarget === save ||
      event.relatedTarget === cancel
    ) {
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
 * naming: the crown for `host`, the one peer whose connection holds the host key
 * and whose leaving puts the room into its grace (`§13.8`).
 *
 * A crown and no word, because the roster is the page's account of who is here
 * and the role is part of who: a mark that is not text needs no room on a row
 * that is mostly a name, and it cannot be read as the rest of that name — `Ada
 * (you) · host` was three marks in a row that read as one sentence. It is not
 * drawn for `guest` — the room's ordinary seat, where a badge would be noise on
 * every row but one — and `viewer` is left out deliberately: it is a statement
 * about what a peer may write, the read-only state is the editor's own to show,
 * and no row here is about permission.
 *
 * The crown is a picture, so what it means is its accessible name and its
 * tooltip: a mark no reader can name is a mark only the people who already know
 * it can use.
 */
function hostMarker(role: Role): HTMLElement | undefined {
  if (role !== 'host') {
    return undefined;
  }
  const marker = document.createElement('span');
  marker.className = 'role';
  marker.setAttribute('role', 'img');
  marker.setAttribute('aria-label', HOST_LABEL);
  marker.title = HOST_LABEL;
  marker.appendChild(iconSpan('crown'));
  return marker;
}

/** What the crown is called where it is not drawn as a word. */
const HOST_LABEL = 'Host';

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
  go.append(iconSpan('go'), verbLabel('Go to'));
  if (peer.path === undefined) {
    // A verb that cannot work is not a verb: the row says where the peer is instead of offering a
    // press that explains, on a phone, that there is nothing to go to.
    const waiting = document.createElement('span');
    waiting.className = 'waiting';
    waiting.textContent = 'not in a file yet';
    actions.appendChild(waiting);
  } else {
    go.addEventListener('click', () => view.onGoTo(peer.peerId));
    actions.appendChild(go);
  }
  // Follow is a toggle: pressed it reads the state it is in, and pressing it again is what stops
  // the follow. The strip's `Stop following` remains the primary place for that; this is the same
  // state from the other side, and it is the only control this row offers once it is the target.
  const follows = view.followedPeerId === peer.peerId;
  const follow = document.createElement('button');
  follow.type = 'button';
  follow.setAttribute('aria-pressed', follows ? 'true' : 'false');
  if (follows) {
    follow.append(iconSpan('follow'), labelSpan('Following'));
    follow.title = STOP_FOLLOW_LABEL;
    follow.addEventListener('click', () => view.onStopFollow(peer.peerId));
  } else {
    follow.append(iconSpan('follow'), verbLabel('Follow'));
    follow.addEventListener('click', () => view.onFollow(peer.peerId));
  }
  actions.appendChild(follow);
  row.appendChild(actions);
  // The refusal the press earned, under the row that was pressed, for as long as the page stands
  // it: `nothing to go to: Ada is not in a document` is about this peer and nowhere else.
  if (view.goToRefusal?.peerId === peer.peerId) {
    const refusal = document.createElement('span');
    refusal.className = 'refusal';
    refusal.textContent = view.goToRefusal.text;
    row.appendChild(refusal);
  }
  return row;
}
