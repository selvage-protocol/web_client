/**
 * The grant tree as a view: what a room change has to redraw, and what it does not.
 *
 * The tree draws two kinds of thing, and they change at completely different rates. Its
 * *rows* — which paths exist, which one is open, what the room knows about each — change when the
 * listing or the room's document set does, which is the user's own doing. Its *badges* — who is in
 * which file — change on every presence frame the room sends, which is every cursor move every peer
 * makes.
 *
 * Redrawing the rows for the second kind is what this module exists to avoid. A listing is a peer's
 * word and can name thousands of paths, and rebuilding that tree costs the main thread seconds per
 * second of a peer's typing; a presence move repaints the two rows the peer left and entered
 * instead, and nothing else.
 *
 * It also owns the create row — the editable line that appears where the entry will be. That is
 * here rather than in a module of its own because the row's whole point is *where it is*: under the
 * directory it will be created in, at the position the name will take. The rules it applies are
 * `new-entry.ts`'s, pure functions over strings.
 *
 * Every decision that is not drawing is a pure function in `tree-state.ts`, so the rules are pinned
 * by tests that need no DOM at all.
 */

import { checkNewEntry } from './new-entry.ts';
import type { NewEntryCheck, NewEntryContext } from './new-entry.ts';
import { fileIcon, iconSpan, labelSpan } from './icons.ts';
import { badgeSignature, changedBadgePaths, initials } from './presence.ts';
import {
  HOST_AWAY_ROW_TITLE,
  NOT_HERE_TAG,
  dirOpen,
  roomMark,
  rowsKey,
} from './tree-state.ts';
import type { Participant } from './editor.ts';
import type { NewEntryKind } from './folder.ts';
import type { GrantChild } from './tree.ts';

/** The slice of the session binding the tree reads. */
export interface TreeSource {
  /** The room's listing: its grant unioned with the documents it holds open. */
  grantListing(): string[];
  /** The immediate children of `directory` in that listing. */
  grantTree(directory?: string): GrantChild[];
  /** The room path in front of the editor, if any. */
  currentPath(): string | undefined;
  /** Whether the room holds this path open, which is what puts a file's text in the room. */
  isOpenInRoom(path: string): boolean;
  /** Whether this window has the path's text. */
  hasText(path: string): boolean;
  /** Whether the text this window has is empty. */
  isTextEmpty(path: string): boolean;
  /** Every participant, with the path each one says it is in. */
  participants(): Participant[];
}

/** What became of one create, in the shape the row has to act on. */
export type CreateResult =
  | { kind: 'made'; path: string; entry: NewEntryKind }
  | { kind: 'refused'; sentence: string }
  | { kind: 'incomplete'; path: string; entry: NewEntryKind; sentence: string };

/**
 * What a row's own work can say while it runs and when it fails.
 *
 * The row is where the person's finger is, so it is where the answer belongs: a progress state in
 * the action's own place, and a line under the row for a sentence that has to stand (design: "a
 * failed action beside its own control"). A toast is for failures with no control on screen.
 */
export interface RowFeedback {
  /** Puts the row's action into its busy state, with the tooltip it wears. */
  busy(label: string): void;
  /** Takes the busy state down. */
  idle(): void;
  /** A line under the row, standing until it is replaced or cleared. */
  note(text: string, actions?: readonly { label: string; run: () => void }[]): void;
  /**
   * Takes the line away — that line, when one is named.
   *
   * A caller that stands a sentence for a while (`Fetching opens …`, five seconds) has to be able to
   * take *its own* sentence down: a fetch that settles inside that stand replaces the line with the
   * outcome and its actions, and a timer that cleared whatever was there would take the only thing
   * the person can act on with it.
   */
  clear(text?: string): void;
}

export interface TreeViewOptions {
  /** The element the tree is drawn into. Emptied and refilled on a rebuild. */
  pane: HTMLElement;
  source: TreeSource;
  /** The directories the guest pinned open. Read on a rebuild, written by the toggles. */
  pinned: Set<string>;
  /** Whether this device has no hover, which is what the row's actions depend on. */
  touch: () => boolean;
  /**
   * Whether this window can put a file into the folder the room is drawn from (`main.ts`: a host
   * that holds one). It decides what an empty listing says, what a row's create actions are, and
   * nothing else: a guest's empty room is the host's to fill.
   */
  canCreate?: () => boolean;
  /** The directories this session made that no listing carries yet, drawn as `only you` rows. */
  localFolders?: () => ReadonlySet<string>;
  /** The paths whose write was refused, with the sentence the folder refused with. */
  unsaved?: () => ReadonlyMap<string, string>;
  /** Whether the host is away and the grace is running: a guest's rows dim while it does. */
  hostAway?: () => boolean;
  /** Runs the create the row asks for. */
  create?: (path: string, entry: NewEntryKind) => Promise<CreateResult>;
  /** Saves a path out of the room, fetching its text first when this window has none. */
  download?: (path: string, feedback: RowFeedback) => void;
  /** A row was clicked: the page decides what opening a path means. */
  open(path: string): void;
}

/** The `⋯` a directory row carries where there is no hover, and what is in it. */
interface MenuItem {
  label: string;
  run: () => void;
}

/** How long a typed name is left alone before the live checks read it. */
const CHECK_DEBOUNCE_MS = 150;

export class GrantTreeView {
  private readonly pane: HTMLElement;
  private readonly source: TreeSource;
  private readonly pinned: Set<string>;
  private readonly options: TreeViewOptions;
  /** What the rows were last built from, so a frame that changes none of it rebuilds none. */
  private drawnRows = '';
  /** Each file row's badge container, so a badge repaint has somewhere to land. */
  private readonly hosts = new Map<string, HTMLElement>();
  /** What each row's badges were last drawn with. */
  private readonly badges = new Map<string, string>();
  /** The create row's state: the kind and the directory it will be created in. */
  private draft: { kind: NewEntryKind; parent: string } | undefined;
  /** The create row's element, kept across rebuilds so a listing change does not take the cursor. */
  private draftRow: HTMLElement | undefined;
  private draftInput: HTMLInputElement | undefined;
  private draftIcon: HTMLElement | undefined;
  private draftHint: HTMLElement | undefined;
  private draftCommit: HTMLButtonElement | undefined;
  private draftSlash: HTMLElement | undefined;
  private draftCheck: NewEntryCheck | undefined;
  private draftBusy = false;
  private pendingCheck: unknown;
  /** The open touch menu, if one is, with the trigger that shows it. */
  private menu: { element: HTMLElement; trigger: HTMLElement } | undefined;
  /** Every directory the room's listing implies, for one rebuild. */
  private listedDirs = new Set<string>();
  /** Whether the create row found its directory in the walk that just ran. */
  private draftPlaced = false;
  /** The create row's own list item, which is what moves as the name is typed. */
  private draftItem: HTMLElement | undefined;
  /**
   * The inline line a row is showing, by path.
   *
   * Kept here rather than only in the DOM because a redraw replaces every row: a fetch that lands
   * rebuilds the tree (its text is in the room now), and a note that went with the old element would
   * vanish in the moment the person was supposed to read it — the sentence about what fetching costs
   * the room stands five seconds, and the fetch itself takes a few milliseconds.
   */
  private readonly notes = new Map<string, HTMLElement>();
  /**
   * The rows whose own work is running, with the tooltip that says what it is.
   *
   * Here for the same reason the notes are: a fetch that lands rebuilds the tree — its text is in
   * the room now — and a spinner that went with the old element would vanish while the work it was
   * reporting was still going on.
   */
  private readonly busy = new Map<string, string>();
  /** The action element each row's download is drawn in, so a rebuild can put its state back. */
  private readonly actionHosts = new Map<string, { wrap: HTMLElement; button: HTMLButtonElement }>();

  constructor(options: TreeViewOptions) {
    this.pane = options.pane;
    this.source = options.source;
    this.pinned = options.pinned;
    this.options = options;
  }

  /**
   * Draws what the room has changed since the last draw. A listing or a row chrome that
   * reads the same rebuilds nothing and repaints only the badges that moved.
   */
  render(): void {
    const listing = this.source.grantListing();
    const current = this.source.currentPath();
    const rows = rowsKey(listing, {
      current,
      touch: this.touch(),
      draft: this.draft === undefined ? '' : `${this.draft.kind}:${this.draft.parent}`,
      local: this.local().join('\n'),
      unsaved: [...this.unsaved().keys()].join('\n'),
      hostAway: this.hostAway(),
      marks: this.markKey(listing, current),
    });
    if (rows === this.drawnRows) {
      this.refreshBadges();
      return;
    }
    this.drawnRows = rows;
    this.rebuild(listing, current);
  }

  /** Empties the pane and forgets the tree, for the end of a session. */
  reset(): void {
    this.drawnRows = '';
    this.hosts.clear();
    this.badges.clear();
    this.draft = undefined;
    this.draftRow = undefined;
    this.draftItem = undefined;
    this.notes.clear();
    this.busy.clear();
    this.actionHosts.clear();
    this.menu = undefined;
    this.pane.replaceChildren();
  }

  /**
   * Opens the create row in `parent` (`''` is the root), which is what the header's `📄+`/`📁+`
   * and a directory row's own action do.
   *
   * A second press while the row is open moves it rather than stacking a second one: there is one
   * name field, and the destination is the last place a person asked to create something.
   */
  beginCreate(kind: NewEntryKind, parent: string): void {
    this.closeMenu();
    this.openDraft(kind, parent);
  }

  /** Whether the create row is open, so the page can move focus to it. */
  isCreating(): boolean {
    return this.draft !== undefined;
  }

  /** The directory the open create row is creating in. */
  creatingIn(): string | undefined {
    return this.draft?.parent;
  }

  /** Takes the create row away, which is what Esc, `✕` and a blur of an empty field do. */
  cancelCreate(): void {
    if (this.draft === undefined) {
      return;
    }
    this.draft = undefined;
    this.draftCheck = undefined;
    this.draftBusy = false;
    this.discardDraftRow();
    this.cancelPendingCheck();
    this.render();
  }

  dispose(): void {
    this.cancelPendingCheck();
  }

  private touch(): boolean {
    return this.options.touch?.() ?? false;
  }

  private canCreate(): boolean {
    return this.options.canCreate?.() ?? false;
  }

  private local(): readonly string[] {
    return [...(this.options.localFolders?.() ?? new Set<string>())].sort();
  }

  private unsaved(): ReadonlyMap<string, string> {
    return this.options.unsaved?.() ?? new Map<string, string>();
  }

  private hostAway(): boolean {
    return this.options.hostAway?.() ?? false;
  }

  /** Repaints the rows whose badges the room has moved, and nothing else. */
  private refreshBadges(): void {
    const presence = this.presenceByPath();
    for (const [path, signature] of changedBadgePaths(this.badges, presence)) {
      const host = this.hosts.get(path);
      if (host === undefined) {
        continue;
      }
      this.badges.set(path, signature);
      host.replaceChildren(...badgeNodes(presence.get(path) ?? []));
    }
  }

  /** Where everyone is, by the room path each participant says it is in. */
  private presenceByPath(): Map<string, Participant[]> {
    const presence = new Map<string, Participant[]>();
    for (const participant of this.source.participants()) {
      if (participant.path !== undefined) {
        const known = presence.get(participant.path) ?? [];
        known.push(participant);
        presence.set(participant.path, known);
      }
    }
    return presence;
  }

  private rebuild(listing: readonly string[], current: string | undefined): void {
    // The create row is a live field: a listing that moved under a person's typing must not take
    // the text they have written or the cursor inside it. The element survives the rebuild; what it
    // may lose is focus, and that is put back.
    const hadFocus = this.draftInput !== undefined && this.pane.ownerDocument.activeElement === this.draftInput;
    const caret = hadFocus ? [this.draftInput?.selectionStart, this.draftInput?.selectionEnd] : undefined;
    this.hosts.clear();
    this.badges.clear();
    this.menu = undefined;
    this.listedDirs = directoryPrefixes(listing);
    // The row is built before the walk, because the walk needs what is typed in it: the position the
    // name will take is the name's own.
    if (this.draft !== undefined) {
      this.buildDraftRow();
    }
    // Reset by the level that owns the row; the fallback below places it when no level does.
    this.draftPlaced = false;
    this.pane.replaceChildren();
    if (listing.length === 0 && this.local().length === 0 && this.draft === undefined) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      // An empty room reads differently to the two people looking at it: a guest is waiting on the
      // host, and a host is the one who can fill it. The host's line is the short one now — the
      // editor pane beside it carries the explanation and the two acts (design §7.2), and the two
      // verbs in this panel's own header are the act the line would otherwise describe.
      empty.textContent = this.canCreate()
        ? 'Nothing here yet.'
        : 'The host has not shared any files yet.';
      this.pane.appendChild(empty);
      return;
    }
    const root = this.level('', 0, current, this.presenceByPath());
    if (this.draft !== undefined && !this.draftPlaced) {
      // The directory the row belongs in is not in the tree — a folder this session made that the
      // page has not yet handed over, or one the listing no longer implies. The row still opens:
      // a name field nobody can see is a control that does nothing.
      root.appendChild(this.placeDraft());
    }
    this.pane.appendChild(root);
    // A row's own line, and its own progress, are redrawn with the row they belong to.
    for (const [path, note] of this.notes) {
      const row = this.hosts.get(path)?.parentElement;
      row?.parentElement?.appendChild(note);
    }
    for (const [path, label] of this.busy) {
      const host = this.actionHosts.get(path);
      if (host === undefined) {
        continue;
      }
      host.wrap.classList.add('busy');
      host.button.setAttribute('aria-label', label);
      host.button.title = label;
    }
    if (hadFocus && this.draftInput !== undefined) {
      this.draftInput.focus();
      if (caret?.[0] !== undefined && caret[0] !== null) {
        this.draftInput.setSelectionRange(caret[0], caret[1] ?? caret[0]);
      }
    }
  }

  /**
   * One level of the tree: the children the listing implies, the directories this session made, in
   * one order, and the create row at the position its name will take.
   */
  private level(
    directory: string,
    depth: number,
    current: string | undefined,
    presence: ReadonlyMap<string, readonly Participant[]>,
  ): HTMLElement {
    const list = document.createElement('ul');
    if (depth === 0) {
      list.style.paddingLeft = '0';
    }
    const children: GrantChild[] = [...this.source.grantTree(directory)];
    const listed = new Set(children.map((child) => child.path));
    for (const path of this.local()) {
      if (parentOf(path) === directory && !listed.has(path)) {
        children.push({ name: leafOf(path), path, directory: true });
      }
    }
    const draft = this.draft?.parent === directory ? this.draft : undefined;
    const draftChild: GrantChild | undefined =
      draft === undefined
        ? undefined
        : { name: draftPathName(this.draftInput?.value ?? ''), path: '', directory: draft.kind === 'directory' };
    for (const child of sortChildren(children)) {
      if (draftChild !== undefined && !this.draftPlaced && orderOf(child) > orderOf(draftChild)) {
        list.appendChild(this.placeDraft());
        this.draftPlaced = true;
      }
      const item = document.createElement('li');
      if (child.directory) {
        item.appendChild(this.directory(child, depth, current, presence));
      } else {
        item.appendChild(this.file(child, current, presence));
      }
      list.appendChild(item);
    }
    if (draftChild !== undefined && !this.draftPlaced) {
      list.appendChild(this.placeDraft());
      this.draftPlaced = true;
    }
    return list;
  }

  /**
   * Moves the row to the place its name now takes among its siblings.
   *
   * The row is already in the tree — it is drawn there when it opens — so this is a move and not a
   * redraw: the listing has not changed, and only the name in the field has.
   */
  private placeDraftRow(): void {
    const item = this.draftItem;
    const list = item?.parentElement;
    if (item === undefined || list === null || list === undefined) {
      return;
    }
    const name = draftPathName(this.draftInput?.value ?? '');
    const order = `${this.draft?.kind === 'directory' ? '0' : '1'}${name}`;
    let before: Element | null = null;
    for (const sibling of list.children) {
      if (sibling === item) {
        continue;
      }
      const row = sibling.children[0];
      const isDirectory = row?.tagName === 'DETAILS';
      const key = `${isDirectory ? '0' : '1'}${nameOf(row)}`;
      if (key > order) {
        before = sibling;
        break;
      }
    }
    if (before === null && list.lastElementChild === item) {
      return;
    }
    list.insertBefore(item, before);
  }

  /** The create row's `<li>`, at the place the walk has reached. */
  private placeDraft(): HTMLElement {
    const item = document.createElement('li');
    item.className = 'new-row';
    item.appendChild(this.buildDraftRow());
    this.draftItem = item;
    return item;
  }

  private directory(
    child: GrantChild,
    depth: number,
    current: string | undefined,
    presence: ReadonlyMap<string, readonly Participant[]>,
  ): HTMLElement {
    const details = document.createElement('details');
    details.dataset.dir = child.path;
    // Openness is the guest's pin, or an ancestor of the open file — never the open file alone, so
    // re-renders keep folders as the guest left them. The create row's own directory is always open.
    details.open =
      this.draft?.parent === child.path || dirOpen(child.path, this.pinned, current);
    // Untrusted toggles are the render above, not the guest: only the guest's own opening and
    // shutting pins a directory.
    details.addEventListener('toggle', (event) => {
      if (!(event as Event).isTrusted) {
        return;
      }
      if (details.open) {
        this.pinned.add(child.path);
      } else {
        this.pinned.delete(child.path);
      }
    });
    const head = document.createElement('summary');
    head.append(iconSpan('chevron'), iconSpan('folder'), nameSpan(child.name));
    head.append(this.directoryChrome(child));
    details.appendChild(head);
    details.appendChild(this.level(child.path, depth + 1, current, presence));
    return details;
  }

  /**
   * A directory's own chrome: the local marker for a folder this session made, and — for a host —
   * the two create actions where a pointer can reach them.
   */
  private directoryChrome(child: GrantChild): HTMLElement {
    const chrome = document.createElement('span');
    chrome.className = 'row-chrome';
    if (!this.isListed(child.path)) {
      const tag = document.createElement('span');
      tag.className = 'local';
      tag.textContent = 'only you';
      tag.title = 'Folders join the room with their first file.';
      chrome.appendChild(tag);
    }
    if (!this.canCreate()) {
      return chrome;
    }
    if (this.touch()) {
      chrome.appendChild(
        this.actionsButton(`More actions for ${child.name}/`, [
          { label: `New file in ${child.path}/`, run: () => this.openDraft('file', child.path) },
          { label: `New folder in ${child.path}/`, run: () => this.openDraft('directory', child.path) },
        ]),
      );
      return chrome;
    }
    chrome.append(
      this.iconButton('file-add', `New file in ${child.path}/`, () => this.openDraft('file', child.path)),
      this.iconButton('folder-add', `New folder in ${child.path}/`, () => this.openDraft('directory', child.path)),
    );
    return chrome;
  }

  /** Whether a directory the page remembered is one the room's listing also carries. */
  private isListed(path: string): boolean {
    return this.listedDirs.has(path);
  }

  private file(
    child: GrantChild,
    current: string | undefined,
    presence: ReadonlyMap<string, readonly Participant[]>,
  ): HTMLElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';
    const listedPath = child.path;
    row.append(iconSpan(fileIcon(listedPath)), nameSpan(child.name));
    // The file this window has open wears no `●`: opening it is what put its text in the room, so for
    // the row the editor is showing the mark is always true, and the row already reads as the open
    // one. Every other row's mark is news — a file whose text has reached the room and one whose has
    // not look the same otherwise — and the peers in a file are this row's badges, which say *who*.
    if (listedPath !== current) {
      appendRoomMark(row, this.markFor(listedPath));
    }
    // The row's own badge container, kept so a presence move repaints this row rather than the tree
    // around it.
    const here = presence.get(listedPath) ?? [];
    const badges = document.createElement('span');
    badges.className = 'presence';
    badges.replaceChildren(...badgeNodes(here));
    this.hosts.set(listedPath, badges);
    this.badges.set(listedPath, badgeSignature(here));
    row.append(badges);
    const refused = this.unsaved().get(listedPath);
    if (refused !== undefined) {
      const warn = document.createElement('span');
      warn.className = 'unsaved';
      warn.textContent = '⚠';
      warn.title = refused;
      row.append(warn);
    }
    if (listedPath === current) {
      row.classList.add('open');
    }
    if (this.hostAway() && this.markFor(listedPath).kind !== 'in-room') {
      row.classList.add('away');
      row.title = HOST_AWAY_ROW_TITLE;
    }
    row.addEventListener('click', () => this.options.open(listedPath));
    if (this.canDownload(listedPath)) {
      row.append(this.downloadChrome(listedPath, child.name));
    }
    return row;
  }

  /**
   * What every row's mark reads, as one string, so a mark that moves redraws the rows.
   *
   * The listing cannot carry this: a path is listed from the grant alone, so a document arriving —
   * which is exactly what `●` is about — can change every mark on screen while the listing reads the
   * same. Without it, a fetched file's row would never gain its dot.
   */
  private markKey(listing: readonly string[], current: string | undefined): string {
    const paths = current === undefined || listing.includes(current) ? listing : [...listing, current];
    return paths
      .map((path) => {
        const mark = this.markFor(path);
        return mark.kind === 'none' ? `${path}:` : `${path}:${mark.kind}`;
      })
      .join('\n');
  }

  /** What the room knows about a path, in the shape `roomMark` reads. */
  private markFor(path: string): ReturnType<typeof roomMark> {
    return roomMark({
      inRoom: this.source.isOpenInRoom(path),
      textHere: this.source.hasText(path),
      textEmpty: this.source.isTextEmpty(path),
      host: this.canCreate(),
    });
  }

  /**
   * Whether the page would offer a download for this row.
   *
   * A host's file that the room does not hold is on the host's own disk already, so the action is
   * left out rather than shown disabled: there is nothing to fetch while you host, and a control
   * that could only refuse is worse than no control. A file the room *does* hold is worth saving for
   * a host too — it is the escape hatch for a write this window was refused.
   */
  private canDownload(path: string): boolean {
    return this.options.download !== undefined && (!this.canCreate() || this.source.isOpenInRoom(path));
  }

  /**
   * The download action: an icon where a pointer can find it in a row's hover, and the same button
   * always visible on a touch device, which has no hover at all.
   */
  private downloadChrome(path: string, name: string): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'row-actions';
    const button = this.iconButton('download', `Download ${name}`, () => this.runDownload(path));
    button.classList.add('download');
    wrap.appendChild(button);
    this.actionHosts.set(path, { wrap, button });
    return wrap;
  }

  private runDownload(path: string): void {
    this.options.download?.(path, this.rowFeedback(path));
  }

  /**
   * What this row's own work says, resolved *by path* every time it is asked.
   *
   * Not by element: a fetch that lands rebuilds the tree, and a control reached after that — the
   * `Try again` on the line the row is showing, say — would otherwise write its progress and its
   * next sentence into the row a rebuild has already thrown away, and a person pressing it would
   * see nothing happen at all. That was a real defect, found by the in-room driver.
   */
  private rowFeedback(path: string): RowFeedback {
    const label = `Download ${leafOf(path)}`;
    const noteHost = (): Element | null | undefined =>
      this.hosts.get(path)?.parentElement?.parentElement;
    return {
      busy: (text) => {
        this.busy.set(path, text);
        const host = this.actionHosts.get(path);
        if (host === undefined) {
          return;
        }
        host.wrap.classList.add('busy');
        host.button.setAttribute('aria-label', text);
        host.button.title = text;
      },
      idle: () => {
        this.busy.delete(path);
        const host = this.actionHosts.get(path);
        if (host === undefined) {
          return;
        }
        host.wrap.classList.remove('busy');
        host.button.setAttribute('aria-label', label);
        host.button.title = label;
      },
      note: (text, actions) => {
        let note = this.notes.get(path);
        if (note === undefined) {
          note = document.createElement('p');
          note.className = 'row-note';
          this.notes.set(path, note);
        }
        note.replaceChildren(text);
        for (const action of actions ?? []) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = action.label;
          button.addEventListener('click', action.run);
          note.appendChild(button);
        }
        noteHost()?.appendChild(note);
      },
      clear: (text) => {
        const note = this.notes.get(path);
        if (note === undefined || (text !== undefined && (note.textContent ?? '') !== text)) {
          return;
        }
        this.notes.delete(path);
        note.remove();
      },
    };
  }

  /** One icon-only control of a row. */
  private iconButton(
    icon: Parameters<typeof iconSpan>[0],
    label: string,
    run: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.appendChild(iconSpan(icon));
    button.addEventListener('click', (event) => {
      // A row's action is not the row: the file row's open, and a summary's own toggle, must both
      // stay out of it.
      event.preventDefault();
      event.stopPropagation();
      run();
    });
    return button;
  }

  /** The `⋯` that carries the actions a touch device cannot reach by hover. */
  private actionsButton(label: string, items: readonly MenuItem[]): HTMLButtonElement {
    const button = this.iconButton('ellipsis', label, () => {
      if (this.menu !== undefined) {
        this.closeMenu();
        return;
      }
      const menu = document.createElement('div');
      menu.className = 'row-menu';
      menu.setAttribute('role', 'menu');
      for (const item of items) {
        const entry = document.createElement('button');
        entry.type = 'button';
        entry.setAttribute('role', 'menuitem');
        entry.textContent = item.label;
        entry.addEventListener('click', () => {
          this.closeMenu();
          item.run();
        });
        menu.appendChild(entry);
      }
      button.parentElement?.appendChild(menu);
      this.menu = { element: menu, trigger: button };
      button.setAttribute('aria-expanded', 'true');
    });
    button.setAttribute('aria-expanded', 'false');
    return button;
  }

  private closeMenu(): void {
    const open = this.menu;
    if (open === undefined) {
      return;
    }
    this.menu = undefined;
    open.element.remove();
    open.trigger.setAttribute('aria-expanded', 'false');
  }

  // ---- the create row --------------------------------------------------------

  /**
   * Opens the row: an empty field with the kind's icon already drawn and the visible `✓` and `✕`.
   * No placeholder — a greyed example is the thing the owner read as a filled value — and no line
   * under it: the field, its two controls and the tree around them say what the row is for, and the
   * line is for what a person cannot see, which is a refusal or the folder the commit will make.
   */
  private openDraft(kind: NewEntryKind, parent: string): void {
    const same = this.draft !== undefined && this.draft.kind === kind && this.draft.parent === parent;
    this.draft = { kind, parent };
    if (!same) {
      // A different kind carries a different icon and a different label on `✓`, so the row is
      // rebuilt; the same kind and destination keeps the element (and whatever is typed in it).
      this.discardDraftRow();
    }
    this.draftCheck = this.check();
    this.applyCheck();
    this.render();
    if (this.draftInput !== undefined) {
      this.draftInput.focus();
      this.draftInput.select?.();
    }
  }

  /** Drops the row's element: the next render builds one for the draft that is open. */
  private discardDraftRow(): void {
    this.draftRow = undefined;
    this.draftInput = undefined;
    this.draftIcon = undefined;
    this.draftHint = undefined;
    this.draftCommit = undefined;
    this.draftSlash = undefined;
  }

  private check(): NewEntryCheck {
    const draft = this.draft;
    if (draft === undefined) {
      return { line: '', error: false, path: undefined };
    }
    const context: NewEntryContext = {
      kind: draft.kind,
      raw: this.draftInput?.value ?? '',
      parent: draft.parent,
      listing: this.source.grantListing(),
      localFolders: this.options.localFolders?.() ?? new Set<string>(),
    };
    return checkNewEntry(context);
  }

  private cancelPendingCheck(): void {
    if (this.pendingCheck !== undefined) {
      clearTimeout(this.pendingCheck as ReturnType<typeof setTimeout>);
      this.pendingCheck = undefined;
    }
  }

  private applyCheck(): void {
    const check = this.draftCheck;
    if (check === undefined) {
      return;
    }
    if (this.draftHint !== undefined) {
      this.draftHint.textContent = check.line;
    }
    this.draftInput?.classList.toggle('invalid', check.error);
    if (this.draftCommit !== undefined) {
      this.draftCommit.disabled = check.path === undefined || this.draftBusy;
    }
    if (this.draftSlash !== undefined) {
      this.draftSlash.hidden = this.draft?.kind !== 'directory';
    }
  }

  private async commit(): Promise<void> {
    const draft = this.draft;
    if (draft === undefined || this.draftBusy) {
      return;
    }
    // Read for the name in the field *now*, not for the one the last debounced check saw: a name
    // typed and committed inside the debounce window would otherwise create what was there a moment
    // ago — or nothing at all.
    this.cancelPendingCheck();
    this.draftCheck = this.check();
    this.applyCheck();
    const check = this.draftCheck;
    if (check === undefined || check.path === undefined) {
      // The reason is already on screen: a second refusal sentence for a name the line has just
      // refused would be the same fact twice.
      return;
    }
    const create = this.options.create;
    if (create === undefined) {
      return;
    }
    this.draftBusy = true;
    this.applyCheck();
    if (this.draftInput !== undefined) {
      this.draftInput.readOnly = true;
    }
    this.draftIcon?.classList.add('busy');
    let result: CreateResult;
    try {
      result = await create(check.path, draft.kind);
    } finally {
      this.draftBusy = false;
      this.draftIcon?.classList.remove('busy');
      if (this.draftInput !== undefined) {
        this.draftInput.readOnly = false;
      }
    }
    if (result.kind === 'refused') {
      // The folder's own sentence, in the line the field has been reading: the name stays typed and
      // the field stays open, because nothing was made.
      this.draftCheck = { line: result.sentence, error: true, path: undefined };
      this.applyCheck();
      this.draftInput?.focus();
      return;
    }
    if (result.entry === 'directory') {
      // A folder's only use in a room is to hold files, so the next step is offered rather than
      // described: the row opens again inside the folder that was just made.
      this.openDraft('file', result.path);
      return;
    }
    this.cancelCreate();
  }

  /** The create row's element, built once and re-placed by every rebuild. */
  private buildDraftRow(): HTMLElement {
    const draft = this.draft;
    if (draft === undefined) {
      throw new Error('no create row to build');
    }
    if (this.draftRow !== undefined) {
      return this.draftRow;
    }
    const row = document.createElement('div');
    row.className = 'new-line';
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconSpan(draft.kind === 'file' ? 'file' : 'folder').innerHTML;
    this.draftIcon = icon;
    row.appendChild(icon);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'new-name';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('aria-label', draft.kind === 'file' ? 'Name for the new file' : 'Name for the new folder');
    input.addEventListener('input', () => {
      // The row follows the name: a file tree lists by name, so the line moves to where the entry
      // will be rather than staying where it was pressed. The move is a DOM move, not a rebuild —
      // the listing has not changed, and rebuilding the tree on every keystroke is the cost this
      // module exists to avoid.
      this.placeDraftRow();
      this.cancelPendingCheck();
      this.pendingCheck = setTimeout(() => {
        this.draftCheck = this.check();
        this.applyCheck();
      }, CHECK_DEBOUNCE_MS);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.commit();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelCreate();
      }
    });
    input.addEventListener('blur', () => {
      // A stray click must not throw away a typed name, and must not create either: only an empty
      // field closes on blur.
      if ((this.draftInput?.value.trim() ?? '') === '') {
        this.cancelCreate();
      }
    });
    this.draftInput = input;
    row.appendChild(input);
    const slash = document.createElement('span');
    slash.className = 'new-slash';
    slash.textContent = '/';
    this.draftSlash = slash;
    row.appendChild(slash);
    const commitButton = document.createElement('button');
    commitButton.type = 'button';
    commitButton.className = 'new-commit';
    commitButton.setAttribute('aria-label', draft.kind === 'file' ? 'Create file' : 'Create folder');
    commitButton.title = draft.kind === 'file' ? 'Create file' : 'Create folder';
    commitButton.appendChild(iconSpan('check'));
    commitButton.addEventListener('mousedown', (event) => event.preventDefault());
    commitButton.addEventListener('click', () => void this.commit());
    this.draftCommit = commitButton;
    row.appendChild(commitButton);
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'new-cancel';
    cancelButton.setAttribute('aria-label', 'Cancel');
    cancelButton.title = 'Cancel';
    cancelButton.appendChild(iconSpan('close'));
    cancelButton.addEventListener('mousedown', (event) => event.preventDefault());
    cancelButton.addEventListener('click', () => this.cancelCreate());
    row.appendChild(cancelButton);
    // Written by `applyCheck` and hidden while it has nothing to say, which is every name this
    // room can take.
    const hint = document.createElement('p');
    hint.className = 'new-hint';
    this.draftHint = hint;
    const wrap = document.createElement('div');
    wrap.className = 'new-row-body';
    wrap.append(row, hint);
    this.draftRow = wrap;
    this.applyCheck();
    return wrap;
  }
}

/**
 * Every directory a listing implies, once per rebuild.
 *
 * A listing is a list of files, so a directory exists only because some path goes through it. Asked
 * once here rather than once per drawn directory: the scan is over the whole listing, and a room may
 * hold thousands of paths.
 */
function directoryPrefixes(listing: readonly string[]): Set<string> {
  const dirs = new Set<string>();
  for (const path of listing) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      dirs.add(segments.slice(0, index).join('/'));
    }
  }
  return dirs;
}

/** A row's name, in its own span so the row can be read (and re-placed) by it. */
function nameSpan(name: string): HTMLSpanElement {
  const span = labelSpan(name);
  span.className = 'label';
  return span;
}

/**
 * The name a drawn row carries, for the order the create row places itself in.
 *
 * A file row holds its name directly; a directory row is a `<details>` whose name is inside the
 * `<summary>` it draws, one level down. Reading only the direct children left every folder with the
 * same empty name, and a folder draft then always landed at the end of the folder group rather than
 * where its name sorts.
 */
function nameOf(row: Element | undefined): string {
  if (row === undefined) {
    return '';
  }
  for (const child of row.children) {
    if (child.classList.contains('label')) {
      return child.textContent ?? '';
    }
    const nested = nameOf(child);
    if (nested !== '') {
      return nested;
    }
  }
  return '';
}

/**
 * Where the create row sorts among its siblings: the first segment of what is typed, or the end
 * while the field is empty — a name nobody has written yet is not one the tree can place.
 */
function draftPathName(raw: string): string {
  const typed = raw.trim().replace(/\/+$/, '');
  if (typed === '') {
    return '\uffff';
  }
  return typed.split('/')[0] ?? '\uffff';
}

/** The directory a path sits in, or `''` for a path at the root. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** The last segment of a path. */
function leafOf(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? '';
}

/**
 * Directories first, then files, each group by code unit — the order `tree.ts` draws a level in, so
 * the create row lands where its name will.
 */
function sortChildren(children: readonly GrantChild[]): GrantChild[] {
  return [...children].sort((left, right) => {
    if (left.directory !== right.directory) {
      return left.directory ? -1 : 1;
    }
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
}

function orderOf(child: GrantChild): string {
  return `${child.directory ? '0' : '1'}${child.name}`;
}

/** The `●`, `empty` or `not fetched yet` a row wears, or nothing. */
function appendRoomMark(row: HTMLElement, mark: ReturnType<typeof roomMark>): void {
  if (mark.kind === 'none') {
    return;
  }
  const span = document.createElement('span');
  span.className = mark.kind === 'in-room' ? 'in-room' : mark.kind === 'empty' ? 'empty-tag' : 'pending-tag';
  span.textContent = mark.kind === 'in-room' ? '●' : mark.kind === 'empty' ? 'empty' : NOT_HERE_TAG;
  span.title = mark.title;
  row.appendChild(span);
}

/**
 * Who is in one file, as initials badges in peer colours: where someone is reads on the
 * tree, glanceable, instead of path text under roster names.
 */
function badgeNodes(present: readonly Participant[]): HTMLElement[] {
  return present.map((participant) => {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.backgroundColor = participant.colour;
    badge.textContent = initials(participant.displayName);
    badge.title = participant.displayName;
    return badge;
  });
}
