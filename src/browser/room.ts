/**
 * The room's people, as a cluster of faces in the session bar and the dialog a face opens.
 *
 * A face carries everything a person glancing at the bar needs: whose seat it is, whether
 * they are the host, and whether this window is following them. The three marks are shapes
 * rather than colours — a solid ring for your own seat, a dashed ring and an eye for the
 * one you follow, a crown for the host — because the room's colours are a small palette
 * and two faces can wear one of them.
 *
 * The words a pair of clients share live here too, and are pinned in both: `Go to`,
 * `Follow`, `Stop following`, `not in a file yet` and the rename intent
 * (`docs/studies/client-command-parity.md` §5). Only one string here is the browser's own,
 * and it is the way back out of a person's menu.
 *
 * What is drawn is a read of the room as it stands, so each draw replaces the children of
 * the element it was given; what the page holds is the state, so this module is testable
 * without a browser.
 */

import type { Role } from '../engine/index.ts';
import { iconSpan, iconSvg, labelSpan } from './icons.ts';
import { rosterLabel } from './names.ts';
import { initials } from './presence.ts';

/** How many faces the cluster shows before the `+N`, on a device with a pointer. */
export const FACE_LIMIT = 5;
/** The same on a phone, where the bar is one row and the cluster shares it with a name. */
export const PHONE_FACE_LIMIT = 3;
/**
 * The `+N`'s own anchor. A face's is its peer id, and no room hands out two ids, so the two kinds
 * of button cannot collide.
 */
export const MORE_ANCHOR = 'more';

/** One seat in the room: a peer the room lists, or this window's own. */
export interface RoomPerson {
  peerId: string;
  displayName: string;
  role: Role;
  /** The colour the caret and the tree badges wear, so a face and a caret agree. */
  colour: string;
  /** The room path the person is in, when they have one open. */
  path: string | undefined;
  /** This connection's own seat, which the room's peer list never carries (`§13.4`). */
  self: boolean;
}

/**
 * The own-name edit, open inside the menu: the page drives it — the name the room is told
 * is the page's, and so is the name in force — and the menu draws it.
 *
 * The protocol's bound is the field's own `maxLength`, so the only refusal left is an empty
 * one, which is what disables the ✓.
 */
export interface RenameEdit {
  /** The name the edit opened on, which is the one left in force when the edit is dropped. */
  opened: string;
  /** What the field shows. */
  value: string;
  maxLength: number;
  /**
   * The field the draw built, which the page keeps: what a press outside the menu reads a typed
   * name from, and the one thing that keeps a half-typed name from being thrown away by it.
   */
  field?: HTMLInputElement;
  commit(value: string): void;
  cancel(): void;
}

/** What a face's press does, and which face is already open. */
export interface RoomView {
  followedPeerId: string | undefined;
  /** The anchor of the open dialog, so the button it came from can say so. */
  openAnchor: string | undefined;
  /** How many faces fit: `FACE_LIMIT`, or `PHONE_FACE_LIMIT` on a phone. */
  limit: number;
  onAnchor(anchor: string): void;
}

/** What a person's menu offers, and what pressing it is. */
export interface PersonMenuView {
  /** Everyone in the room, for the number a shared name is told apart by. */
  all: readonly RoomPerson[];
  followedPeerId: string | undefined;
  /** The menu was opened from the everyone list, so it carries the way back to it. */
  fromList: boolean;
  renaming?: RenameEdit;
  /**
   * The sentence a go-to was refused with, when it is about this person: a race — the peer
   * closed the file, or the caret does not resolve here — and the press is where the answer
   * belongs. The page stands it and takes it down (`main.ts`); it is not a state.
   */
  goToRefusal?: { peerId: string; text: string };
  onGoTo(peerId: string): void;
  onFollow(peerId: string): void;
  /** The press on the control already following: the toggle's own off. */
  onStopFollow(peerId: string): void;
  /** Opens the own-name edit. Absent where the page has no name to change. */
  onRename?(): void;
  onBack(): void;
}

/** The list of everyone, and the row that opens a person's menu from it. */
export interface EveryoneMenuView {
  followedPeerId: string | undefined;
  onPick(peerId: string): void;
}

/**
 * The rename intent's words, which both desktop clients give their command
 * (`docs/studies/client-command-parity.md` §5): the control's own text is the verb, and
 * this is what a screen reader and a pointer read on it.
 */
const RENAME_LABEL = 'Set the name other participants see';

/** What the field is called. A form field needs a name a screen reader can read it by. */
const NAME_FIELD_LABEL = 'The name other participants see';

/**
 * What the edit's two visible ways out are called, in the create row's own words: the
 * controls are the tree's ✓ and ✕ and carry no text of their own, so this is what a screen
 * reader reads and what a pointer finds in the tooltip.
 */
const RENAME_SAVE_LABEL = 'Set this name';
const RENAME_CANCEL_LABEL = 'Leave the name as it is';

/** What the crown is called where it is not drawn as a word. */
const HOST_LABEL = 'Host';

/** What the `+N` opens, and the name of the list it opens onto. */
const EVERYONE_LABEL = 'Everyone in the room';

/** Where a person is, when the answer is nowhere. */
const NO_PATH = 'not in a file yet';

/** The label a face and a row carry for one person, peers with one name told apart. */
function personName(person: RoomPerson, all: readonly RoomPerson[]): string {
  return rosterLabel(person, all);
}

/**
 * What a face's accessible name carries: the person, and the marks that are drawn on the
 * face as shapes and colours the readers who cannot see them still need.
 */
export function faceLabel(
  person: RoomPerson,
  all: readonly RoomPerson[],
  following: string | undefined,
): string {
  const marks = [
    person.self ? '(you)' : '',
    person.role === 'host' ? 'host' : '',
    person.peerId === following ? 'following' : '',
  ].filter((mark) => mark !== '');
  const name = personName(person, all);
  return marks.length === 0 ? name : `${name}, ${marks.join(', ')}`;
}

/** The host's face reads its role beside the name; every other face reads the bare name. */
function faceTitle(person: RoomPerson, all: readonly RoomPerson[]): string {
  const name = personName(person, all);
  return person.role === 'host' ? `${name} \u00b7 ${HOST_LABEL}` : name;
}

/**
 * The faces the cluster shows, and the ones behind the `+N`.
 *
 * You are always first, and the followed face is never behind the `+N`: its ring is the
 * one place a follow shows on this bar, so it takes the last shown slot when it would
 * otherwise be hidden.
 */
export function visibleFaces(
  people: readonly RoomPerson[],
  limit: number,
  following: string | undefined,
): { shown: RoomPerson[]; hidden: RoomPerson[] } {
  if (people.length <= limit) {
    return { shown: [...people], hidden: [] };
  }
  const shown = people.slice(0, limit - 1);
  const followed = people.find((person) => person.peerId === following);
  if (followed !== undefined && !shown.includes(followed)) {
    shown[shown.length - 1] = followed;
  }
  return { shown, hidden: people.filter((person) => !shown.includes(person)) };
}

/** One avatar's classes: your own seat wears the solid ring, the followed one the dashed. */
function avatarClasses(person: RoomPerson, following: string | undefined, plain: boolean): string {
  const classes = ['av'];
  if (!plain && person.self) {
    classes.push('me');
  }
  if (!plain && person.peerId === following) {
    classes.push('followed');
  }
  return classes.join(' ');
}

/** The crown the host's face wears: a picture, so what it means is its name. */
function crownMark(): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'crown';
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', HOST_LABEL);
  mark.innerHTML = iconSvg('crown');
  return mark;
}

/** The pip on the followed face, as the follow's own eye. */
function eyeMark(): HTMLElement {
  const pip = document.createElement('span');
  pip.className = 'eye';
  pip.setAttribute('aria-hidden', 'true');
  pip.append(iconSpan('follow'));
  return pip;
}

/** What stands inside an avatar, wherever one is drawn. */
function avatarBody(
  person: RoomPerson,
  all: readonly RoomPerson[],
  following: string | undefined,
  plain: boolean,
): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (person.role === 'host') {
    parts.push(crownMark());
  }
  const letters = document.createElement('span');
  letters.setAttribute('aria-hidden', 'true');
  letters.textContent = initials(personName(person, all));
  parts.push(letters);
  if (!plain && person.peerId === following) {
    parts.push(eyeMark());
  }
  return parts;
}

/** A face that does nothing: the menu's header and the rows of the everyone list. */
function avatarSpan(
  person: RoomPerson,
  all: readonly RoomPerson[],
  following: string | undefined,
  plain: boolean,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = avatarClasses(person, following, plain);
  span.style.setProperty('--c', person.colour);
  span.append(...avatarBody(person, all, following, plain));
  return span;
}

/** One face of the cluster: a button that opens this person's menu. */
function faceButton(
  person: RoomPerson,
  all: readonly RoomPerson[],
  view: RoomView,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = avatarClasses(person, view.followedPeerId, false);
  button.style.setProperty('--c', person.colour);
  button.setAttribute('data-anchor', person.peerId);
  button.setAttribute('aria-label', faceLabel(person, all, view.followedPeerId));
  button.title = faceTitle(person, all);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', String(view.openAnchor === person.peerId));
  button.addEventListener('click', () => view.onAnchor(person.peerId));
  button.append(...avatarBody(person, all, view.followedPeerId, false));
  return button;
}

/** The `+N`: the faces the cluster could not show, and the list that holds them all. */
function moreButton(hidden: number, view: RoomView): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'av more';
  button.setAttribute('data-anchor', MORE_ANCHOR);
  button.setAttribute('aria-label', `${hidden} more \u2014 everyone in the room`);
  button.title = EVERYONE_LABEL;
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', String(view.openAnchor === MORE_ANCHOR));
  button.textContent = `+${hidden}`;
  button.addEventListener('click', () => view.onAnchor('more'));
  return button;
}

/**
 * Draws the cluster: the faces, the `+N`, and the group they are one of.
 *
 * The group is named for the room as a whole, so the count is read once rather than once per face.
 */
export function renderRoom(
  host: HTMLElement,
  people: readonly RoomPerson[],
  view: RoomView,
): void {
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', `${people.length} in the room`);
  const { shown, hidden } = visibleFaces(people, view.limit, view.followedPeerId);
  const faces: HTMLElement[] = shown.map((person) => faceButton(person, people, view));
  if (hidden.length > 0) {
    faces.push(moreButton(hidden.length, view));
  }
  host.replaceChildren(...faces);
}

/**
 * Draws one person's menu over the dialog element the page keeps open.
 *
 * The acts are the ones the old roster row carried, in the same words: to go where someone
 * is, to follow them, to stop, and the own name's edit. A peer in no file is offered no
 * `Go to` — a verb that can only refuse is not offered — and says where they are instead.
 */
export function renderPersonMenu(
  menu: HTMLElement,
  person: RoomPerson,
  view: PersonMenuView,
): void {
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', personName(person, view.all));
  const parts: HTMLElement[] = [];
  if (view.fromList) {
    parts.push(backButton(view.onBack));
  }
  parts.push(personHead(person, view.all));
  parts.push(personActs(person, view));
  menu.replaceChildren(...parts);
}

function backButton(onBack: () => void): HTMLButtonElement {
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'back';
  back.append(iconSpan('back'), labelSpan(EVERYONE_LABEL));
  back.addEventListener('click', () => onBack());
  return back;
}

function personHead(person: RoomPerson, all: readonly RoomPerson[]): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'head';
  const face = avatarSpan(person, all, undefined, true);
  const who = document.createElement('div');
  who.className = 'who';
  const line = document.createElement('div');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = personName(person, all);
  line.appendChild(name);
  const marks = document.createElement('span');
  marks.className = 'marks';
  marks.textContent = person.self ? '(you)' : '';
  line.appendChild(marks);
  who.appendChild(line);
  // Where the person is is the other half of who they are, and the only place a `Go to` can
  // point. Your own seat is where the editor already is, so it says nothing.
  if (!person.self) {
    const where = document.createElement('div');
    where.className = 'where';
    where.textContent = person.path === undefined ? NO_PATH : `in ${person.path}`;
    who.appendChild(where);
  }
  head.append(face, who);
  return head;
}

function personActs(person: RoomPerson, view: PersonMenuView): HTMLDivElement {
  const acts = document.createElement('div');
  acts.className = 'acts';
  if (person.self) {
    acts.appendChild(view.renaming === undefined ? renameButton(view) : renameField(view.renaming));
    return acts;
  }
  if (person.path === undefined) {
    const waiting = document.createElement('div');
    waiting.className = 'waiting';
    waiting.textContent = NO_PATH;
    acts.appendChild(waiting);
  } else {
    const go = document.createElement('button');
    go.type = 'button';
    // The anchor the page keeps focus on when the room refuses this press, rather than moving it
    // off the control the person actually used.
    go.setAttribute('data-act', 'go');
    go.append(iconSpan('go'), labelSpan('Go to'));
    go.addEventListener('click', () => view.onGoTo(person.peerId));
    acts.appendChild(go);
  }
  acts.appendChild(followButton(person, view));
  // Under the verbs of the person it is about, the way the roster row carried it.
  if (view.goToRefusal?.peerId === person.peerId) {
    const refusal = document.createElement('div');
    refusal.className = 'refusal';
    refusal.textContent = view.goToRefusal.text;
    acts.appendChild(refusal);
  }
  return acts;
}

function renameButton(view: PersonMenuView): HTMLButtonElement {
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.setAttribute('data-act', 'rename');
  rename.append(iconSpan('edit'), labelSpan('Rename'));
  rename.title = RENAME_LABEL;
  rename.setAttribute('aria-label', RENAME_LABEL);
  rename.addEventListener('click', () => view.onRename?.());
  return rename;
}

/**
 * The name's edit, in place of the control that opened it.
 *
 * Enter sends and Escape cancels, as they always did; the ✓ and ✕ beside the field are the
 * visible pair for a person who does not already know the keys, and the ✓ is disabled
 * while the field names nothing — the protocol's bound is the field's own `maxLength`, so
 * an empty field is the whole of what a name can be refused for.
 */
function renameField(rename: RenameEdit): HTMLDivElement {
  const group = document.createElement('div');
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
  rename.field = field;
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
  const updateSave = (): void => {
    save.disabled = field.value.trim() === '';
  };
  field.addEventListener('input', updateSave);
  updateSave();
  field.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      rename.commit(field.value);
      return;
    }
    if (event.key === 'Escape') {
      // The menu stays open on the control that opened the edit; the page's own Escape
      // handler is the one that closes the whole dialog, and this key is not it.
      event.preventDefault();
      event.stopPropagation();
      rename.cancel();
    }
  });
  group.append(field, save, cancel);
  return group;
}

function followButton(person: RoomPerson, view: PersonMenuView): HTMLButtonElement {
  const follows = view.followedPeerId === person.peerId;
  const follow = document.createElement('button');
  follow.type = 'button';
  follow.setAttribute('aria-pressed', String(follows));
  // The words are the state, and the state is what the press undoes: one control, two sides
  // of the same toggle, as the file strip's own Stop is.
  follow.append(iconSpan(follows ? 'stop' : 'follow'), labelSpan(follows ? 'Stop following' : 'Follow'));
  if (follows) {
    follow.title = 'Stop following';
    follow.addEventListener('click', () => view.onStopFollow(person.peerId));
  } else {
    follow.addEventListener('click', () => view.onFollow(person.peerId));
  }
  return follow;
}

/**
 * Draws everyone in the room: the count, and one row per person, in the cluster's own
 * order — your own seat first.
 *
 * A row opens that person's menu the way their face does, with the way back to this list
 * in it.
 */
export function renderEveryoneMenu(
  menu: HTMLElement,
  people: readonly RoomPerson[],
  view: EveryoneMenuView,
): void {
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', EVERYONE_LABEL);
  const head = document.createElement('div');
  head.className = 'head';
  const who = document.createElement('div');
  who.className = 'who';
  const count = document.createElement('div');
  count.className = 'name';
  count.textContent = `${people.length} in the room`;
  who.appendChild(count);
  head.appendChild(who);
  const list = document.createElement('ul');
  list.className = 'list';
  for (const person of people) {
    list.appendChild(everyoneRow(person, people, view));
  }
  menu.replaceChildren(head, list);
}

function everyoneRow(
  person: RoomPerson,
  all: readonly RoomPerson[],
  view: EveryoneMenuView,
): HTMLLIElement {
  const item = document.createElement('li');
  const row = document.createElement('button');
  row.type = 'button';
  row.setAttribute('data-pick', person.peerId);
  const where = person.self ? '' : person.path === undefined ? NO_PATH : `in ${person.path}`;
  // The row is one control, so the face inside it is not a second one to reach, and the name
  // the row reads carries the marks the face wears.
  row.setAttribute('aria-label', where === '' ? faceLabel(person, all, view.followedPeerId) : `${faceLabel(person, all, view.followedPeerId)}, ${where}`);
  const face = avatarSpan(person, all, view.followedPeerId, false);
  face.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'label';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = personName(person, all);
  if (person.self) {
    const marks = document.createElement('span');
    marks.className = 'marks';
    marks.textContent = '(you)';
    name.appendChild(marks);
  }
  const at = document.createElement('span');
  at.className = 'where';
  at.textContent = where === '' ? '' : person.path === undefined ? NO_PATH : person.path;
  label.append(name, at);
  row.append(face, label);
  row.addEventListener('click', () => view.onPick(person.peerId));
  item.appendChild(row);
  return item;
}

/** Where the dialog stands, given the face it came from and the frame it lives in. */
export interface MenuPlacement {
  left: number;
  top: number;
}

/**
 * Under the face, and inside the frame: the dialog's right edge keeps the face's own, its
 * left edge stays 8 px off the frame's, and its top is the face's bottom plus 8 px.
 */
export function menuPlacement(
  anchor: { right: number; bottom: number },
  frame: { left: number; top: number; width: number },
  menuWidth: number,
): MenuPlacement {
  return {
    left: Math.max(8, Math.min(anchor.right - frame.left - menuWidth, frame.width - menuWidth - 8)),
    top: anchor.bottom - frame.top + 8,
  };
}

/** Places the open dialog under the face it came from, measured as it stands. */
export function placeMenu(menu: HTMLElement, anchor: HTMLElement, frame: HTMLElement): void {
  const { left, top } = menuPlacement(
    anchor.getBoundingClientRect(),
    frame.getBoundingClientRect(),
    menu.offsetWidth,
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/**
 * Puts focus on the first control of the menu, or on the one a selector names — which is
 * the field when the edit is what the press opened, and the control that opened it when
 * the edit is dropped.
 */
export function focusInto(menu: HTMLElement, selector?: string): void {
  const target = menu.querySelector<HTMLElement>(selector ?? 'input, button:not(:disabled)');
  if (target === null) {
    return;
  }
  target.focus();
  if (target.tagName === 'INPUT') {
    (target as HTMLInputElement).select();
  }
}
