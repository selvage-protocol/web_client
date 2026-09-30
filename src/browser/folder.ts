/**
 * A folder a browser host was handed, as an `EditorHost`'s working copy.
 *
 * `showDirectoryPicker` gives the page a `FileSystemDirectoryHandle`, and that handle *is* the
 * grant: a room path is walked one segment at a time through `getDirectoryHandle` /
 * `getFileHandle` on a directory the person picked, so there is no `..` to resolve, no absolute
 * path to reach for and no spelling that names something outside the folder — the API has no
 * expression for one. What a browser host therefore does not need is the desktop adapters' own
 * confinement walk (`vscode_client/src/adapter/grant.ts`), and what it must still apply is the
 * shared rule that decides which names a session shares at all (`GRANT_EXCLUDED_DIRS`, `.env`,
 * the key names, the size and format bounds), which is why `../bridge/` is imported here.
 *
 * The folder's own ignore files narrow that rule the way they narrow a `git status`: the repository
 * exclude at the lowest precedence, then every `.gitignore` at or below the folder, the last
 * matching pattern deciding. They are read through the same handles, so the folder is still the
 * bound — nothing above it is read, and neither git's user-wide ignore nor any other rule outside
 * it is — and they bind a path a peer names as well as the listing.
 *
 * The exclusion rules are evaluated as though the folder's filesystem folds case, which is the
 * shared rule's answer for a host whose platform it cannot read (`foldsCase('')`): the browser
 * cannot tell whether the person picked a case-insensitive volume, and sharing less is the
 * safer error. The visible cost is a top-level `Build/` that a case-sensitive checkout would
 * have shared and this does not.
 *
 * Every handle here is structural (an interface with the methods this module calls) rather than
 * `FileSystemDirectoryHandle`, so the suite drives the whole module with hand-built doubles and
 * no browser (§4.1 of the study).
 *
 * `create` is the one act that puts a name the host typed into the folder, and it is held to the
 * same rules as sharing one: the shared excludes, the binary-name rule and the path bounds are
 * applied before anything is resolved, and a name the folder already holds is refused rather than
 * adopted. What it makes is a host-side act for the listing to publish: the walk that publishes is
 * the caller's, and it finds the new path because the folder now holds it.
 *
 * `remove` and `move` are the other two acts that change what the folder holds, and they are held to
 * the same rule: every path is one the grant would publish, decided before anything is resolved, so
 * none of the three can name a file the person did not hand over.
 */

import {
  MAX_GRANT_FILE_BYTES,
  isBinaryNamedPath,
  isGrantedPath,
  isIgnoredPath,
  walkListing,
} from '../bridge/index.ts';
import type {
  GrantRefusal,
  GrantedRead,
  IgnoreSource,
  LineEnding,
  ListingCut,
  ListingWalkSource,
  WalkEntry,
} from '../bridge/index.ts';

/**
 * The platform handed to the shared exclusion rule: none. A browser knows neither the host
 * filesystem's case folding nor its separator conventions, and `isGrantedPath` reads an empty
 * platform as "unknown — fold", which excludes more rather than less.
 *
 * Exported because the create row's live checks apply the same rule before a commit does
 * (`new-entry.ts`): a name refused while it is being typed and a name refused on commit have to
 * be refused by one rule, or a row would promise a file the folder then declines.
 */
export const FOLDER_PLATFORM = '';

/**
 * Which bound stopped a walk, as this page's consumers read it: the shared walk's own `ListingCut`,
 * under the name they already import (`notice.ts`).
 */
export type FolderCut = ListingCut;

/**
 * What the page says when its own walk stopped short of the folder.
 *
 * The host is the only one who can act on it — a short listing is a listing like any other, and no
 * frame carries a cut — so this is said in the host's own window and nowhere else. The bounds are
 * the protocol's, but the person sharing the folder is not the protocol: each sentence names what
 * the folder is holding, and what sharing a smaller one would give the room.
 */
export function listingCutSentence(cut: FolderCut): string {
  switch (cut) {
    case 'paths':
      return 'This folder holds more files than one room listing carries, so the room has only the first part of it. Share a smaller folder to give the room all of it.';
    case 'bytes':
      return 'This folder’s paths are longer in total than one room listing carries, so the room has only the first part of it. Share a folder with shorter paths to give the room all of it.';
    case 'budget':
      return 'Reading this folder took more work than one listing walk pays for, so the room may be missing some of its files. Share a smaller folder to give the room all of it.';
  }
}

/** The ignore file any directory of the folder may state for its children. */
const IGNORE_FILE = '.gitignore';

/** The repository exclude a `.git` folder may state, under `info/`. */
const EXCLUDE_FILE = 'exclude';

/** One file as the page reads it: the stamp the stale-file guard compares, and the bytes. */
export interface FolderFile {
  readonly lastModified: number;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** An open writable file: the room's settled text goes in, then the write is closed. */
export interface FolderWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FolderFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<FolderFile>;
  createWritable(): Promise<FolderWritable>;
}

/**
 * The one option this module passes to a handle lookup: the API's own create.
 *
 * Without it a lookup for a name that is not there rejects (`NotFoundError`), which is what every
 * read and write here relies on; with it the entry is made and its handle returned.
 */
export interface FolderLookupOptions {
  create?: boolean;
}

/** One entry of a directory listing: the two fields the walk reads. */
export interface FolderEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
}

export interface FolderDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterableIterator<FolderEntry>;
  getDirectoryHandle(
    name: string,
    options?: FolderLookupOptions,
  ): Promise<FolderDirectoryHandle>;
  getFileHandle(name: string, options?: FolderLookupOptions): Promise<FolderFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** The picker, as this module calls it. Injected so the suite needs no browser. */
export type PickFolder = (options: {
  mode: 'readwrite';
  id: string;
}) => Promise<FolderDirectoryHandle>;

/** Why no folder was handed over. */
export type FolderPickRefusal =
  /** This browser has no directory picker at all: Firefox, Safari, and every page that is not
   * a secure context. */
  | 'unsupported'
  /** The browser refused: not called from a user gesture, or a folder it will not hand over. */
  | 'refused';

export type FolderPick =
  | { kind: 'picked'; folder: FolderWorkingCopy }
  /**
   * The person dismissed the prompt. It is its own outcome rather than a refusal with a sentence:
   * choosing not to share a folder is not a mistake to be told about, and a card that wrote a red
   * line for it made a decision look like a failure (design §7.1). The card is simply as it was.
   */
  | { kind: 'cancelled' }
  | { kind: 'refused'; cause: FolderPickRefusal; sentence: string };

/** The picker's own id, so the browser reopens where the person last chose. */
const PICKER_ID = 'selvage';

/** The id the picker asks with, for the page's own tests. */
export const FOLDER_PICKER_ID = PICKER_ID;

/** The picker options this module always asks with: a room writes back, so read and write. */
export const FOLDER_PICKER_OPTIONS = { mode: 'readwrite', id: PICKER_ID } as const;

/** What a refused pick says, in the card's own words. */
export function folderPickSentence(cause: FolderPickRefusal, detail = ''): string {
  switch (cause) {
    case 'unsupported':
      return 'This browser cannot hand a page a folder. Chrome and Edge can, but Firefox and Safari cannot. Joining a room here still works.';
    case 'refused':
      return `The browser would not hand over that folder${detail === '' ? '' : ` (${detail})`}. A system folder, or your home directory itself, cannot be shared.`;
  }
}

/** Why a write did not land. */
export type FolderWriteRefusal =
  /** Not a path the grant would publish. */
  | 'not-granted'
  /** Nothing there: deleted since the listing, or never there. */
  | 'missing'
  /** Something there that is not a plain file. */
  | 'not-a-file'
  /** The page never read this path, so the write would overwrite text it has never seen. */
  | 'unread'
  /**
   * The file's modification stamp moved since this page last read or wrote it: something else
   * wrote it, in the shape the guard can see. A writer that preserves the stamp is not caught.
   */
  | 'stale'
  /** The person revoked write access, or the folder moved with the tab open. */
  | 'not-permitted';

export type FolderWrite =
  | { kind: 'written' }
  | { kind: 'refused'; cause: FolderWriteRefusal; sentence: string };

/** What a create makes: one file, or one directory, at a path a person typed. */
export type NewEntryKind = 'file' | 'directory';

/** Why nothing was removed. */
export type FolderRemoveRefusal =
  /** Not a path the grant would publish: outside the folder, or a name the grant excludes. */
  | 'not-granted'
  /** Nothing there: removed since the listing, or never there. */
  | 'missing'
  /** The person revoked write access, or the folder moved with the tab open. */
  | 'not-permitted';

/**
 * What a removal took out: the path, and the listed files that went with it.
 *
 * The second is the page's, not the folder's: a document is a path, so the files a folder took with
 * it are the paths whose text has to leave the room as well, and only the listing says which they
 * were (a room's listing is files, so a folder is in it only through them).
 */
export type FolderRemove =
  | { kind: 'removed'; path: string; paths: readonly string[] }
  | { kind: 'refused'; cause: FolderRemoveRefusal; sentence: string };

/** Why a move did not happen, or happened only halfway. */
export type FolderMoveRefusal =
  | FolderRemoveRefusal
  | FolderCreateRefusal
  | FolderWriteRefusal
  /** A file over the size a room will carry. */
  | 'too-large'
  /** The two paths are one: there is nowhere to move it to. */
  | 'same'
  /** The destination is inside the folder being moved: a folder cannot hold itself. */
  | 'inside'
  /**
   * The folder holds a file the room's listing does not carry.
   *
   * The excludes are a list of names a room must never see at all, the walk leaves out a name that
   * declares a format a room cannot carry and one over the size it carries, and a folder can fall
   * outside the walk's budget. A folder moves whole or not at all, so one holding such an entry is
   * refused rather than half-moved and then emptied of it.
   */
  | 'unshared';

/**
 * What a move came to.
 *
 * `paths` are the listed files that moved, whose old path is gone: what the page needs to take
 * their documents out of the room. A file carries itself, a folder carries every listed file inside
 * it, and a `partial` carries only the ones that landed.
 *
 * `partial` is the one that needs saying out loud: a move in this client is a write at the new name
 * and a removal at the old, and the folder can refuse the removal after the write has landed. The
 * file is then at both paths, which is not a failed move and is not a finished one either. A folder
 * reaches the same state one file at a time, or through its own removal once its contents have
 * moved.
 */
export type FolderMove =
  | { kind: 'moved'; from: string; to: string; paths: readonly string[] }
  | { kind: 'refused'; cause: FolderMoveRefusal; sentence: string }
  | { kind: 'partial'; from: string; to: string; paths: readonly string[]; sentence: string };

/** What a path being moved is in the folder the person picked, or why nothing can be said of it. */
type MoveSource =
  | { kind: 'file' }
  | { kind: 'directory'; handle: FolderDirectoryHandle }
  | { kind: 'refused'; cause: FolderMoveRefusal };

/** Why nothing was created. */
export type FolderCreateRefusal =
  /** A name the grant's own rules refuse: an exclude, a key name, `..`, an absolute path. */
  | 'not-granted'
  /** A file whose name declares a format a room cannot carry (the listing's binary rule). */
  | 'binary'
  /** Something is already at that path. The page replaces and renames nothing the folder holds. */
  | 'exists'
  /** A directory the path goes through is not there. Create makes one segment, not a tree. */
  | 'missing'
  /** A segment the path goes through is a file, not a directory. */
  | 'not-a-file'
  /** The person revoked write access, or the folder moved with the tab open. */
  | 'not-permitted';

export type FolderCreate =
  | { kind: 'created'; path: string; entry: NewEntryKind }
  | { kind: 'refused'; cause: FolderCreateRefusal; sentence: string };

/**
 * What the editor's host half needs of a working copy: a read for a path the room asked for,
 * a write of the text the room settled on, and how the file itself was laid out when this window
 * read it. Structural, so the binding's own tests drive it with a double while
 * `FolderWorkingCopy` is what the page hands over.
 */
export interface FolderWork {
  read(path: string): Promise<GrantedRead>;
  write(path: string, text: string): Promise<FolderWrite>;
  layout(path: string): FileLayout | undefined;
}

/**
 * How a file's own bytes are laid out, as the last read of it saw them.
 *
 * A room's replica is LF whatever the file is (`toCrdt`), so a buffer built from it has to be told
 * the ending the file wears or the next write puts every line back as LF. The byte order mark is
 * here for the same reason from the other side: the reader strips it, and the writer has to put it
 * back or the file loses it on the first edit. Both are recorded with the stamp, because a read is
 * the only time this module sees the file's bytes.
 */
export interface FileLayout {
  /** The ending the file's bytes use. */
  readonly eol: LineEnding;
  /** Whether the bytes open with a UTF-8 byte order mark, which the reader strips from the text. */
  readonly bom: boolean;
}

/**
 * What a refused create says, per cause.
 *
 * The same kind of sentence a refused write gets: it names the path, says plainly that nothing was
 * made, and where a person can act it names the next step. `exists` is the one that has to be said
 * rather than implied, because the API's own `create` would have opened what is there instead.
 */
export function folderRemoveSentence(cause: FolderRemoveRefusal, path: string): string {
  switch (cause) {
    case 'not-granted':
      return `${path} is not a path this room shares, so nothing was removed.`;
    case 'missing':
      return `${path} is already gone from the folder.`;
    case 'not-permitted':
      return `${path} could not be removed: this page no longer has write access to the folder. Grant it again from the address bar and try again.`;
  }
}

/**
 * What a refused or half-finished move says, per cause.
 *
 * Both paths are named, because a move is the one act here that is about two names at once and the
 * answer to "what happened?" is a statement about each of them.
 */
export function folderMoveSentence(
  cause: FolderMoveRefusal,
  from: string,
  to: string,
  detail = '',
): string {
  switch (cause) {
    case 'not-granted':
      return `${from} or ${to} is not a path this room shares, so nothing was moved.`;
    case 'missing':
      return `${from} is not in the folder any more, so nothing was moved.`;
    case 'not-a-file':
      return `${from} or ${to} goes through something that is a file, not a folder, so nothing was moved.`;
    case 'too-large':
      return `${from} is larger than a room will carry, so nothing was moved.`;
    case 'binary':
      return `${from} is not text a room can carry, so nothing was moved.`;
    case 'exists':
      return `${to} is already in the folder, so nothing was moved. This page replaces and renames nothing the folder holds.`;
    case 'unread':
      return `${from} had not been read from the folder before this move, so it was left alone.`;
    case 'stale':
      return `${to} changed on disk while it was being moved, so it was left alone.`;
    case 'not-permitted':
      return `${from} could not be moved: this page no longer has write access to the folder. Grant it again from the address bar and try again.`;
    case 'same':
      return `${from} is already there, so nothing was moved.`;
    case 'inside':
      return `${from} cannot be moved into ${to}, which is inside it, so nothing was moved.`;
    case 'unshared':
      return detail === ''
        ? `${from} was not moved: it holds a file this room does not carry, and a folder moves whole or not at all.`
        : `${from} was not moved: it holds ${detail}, which this room does not carry. A folder moves whole, or not at all.`;
  }
}

/** What a move whose copy landed and whose removal did not says. */
export function folderMovePartialSentence(from: string, to: string, reason: string): string {
  return `${from} is now at ${to} as well, but the original was not removed: ${reason}`;
}

/** Why nothing was created. */
export function folderCreateSentence(cause: FolderCreateRefusal, path: string): string {
  switch (cause) {
    case 'not-granted':
      return `${path} is not a path this room shares, so it was not created.`;
    case 'binary':
      return `${path} is a name that declares a format a room cannot carry, so it was not created. Name a text file instead.`;
    case 'exists':
      return `${path} is already in the folder, so nothing was created. This page does not rename or replace what the folder holds. Name something else.`;
    case 'missing':
      return `${path} is not in the folder: the directory it goes through has to exist before a name inside it can be created. Create that directory first.`;
    case 'not-a-file':
      return `${path} goes through something that is a file, not a directory, so nothing was created.`;
    case 'not-permitted':
      return `${path} could not be created: this page no longer has write access to the folder. Grant it again from the address bar and try again.`;
  }
}

/**
 * The stale-file guard's sentence, per cause.
 *
 * This is the one thing a browser host must say out loud: the page holds a replica and a
 * directory handle and cannot see the file change underneath it, so without this it would
 * write the room's settled text over whatever a formatter, a build, a `git checkout` or the
 * person's own editor put there. The desktop clients both notice an external change and both
 * refuse or reconcile on save; a page cannot, so it refuses when the stamp it remembers is not
 * the stamp the file carries now, and says which of the two it is.
 */
export function folderWriteSentence(cause: FolderWriteRefusal, path: string): string {
  switch (cause) {
    case 'not-granted':
      return `${path} is not a path this room shares, so it was not written.`;
    case 'missing':
      return `${path} is not in the folder any more, so nothing was written. If it was renamed or deleted, the room\u2019s text is the only copy left.`;
    case 'not-a-file':
      return `${path} is not a plain file in the folder any more, so nothing was written.`;
    case 'unread':
      return `${path} had not been read from the folder before this write, so it was left alone rather than overwritten with text this page never saw.`;
    case 'stale':
      return `${path} changed on disk since the room read it, so it was left alone rather than overwritten. Something else wrote to it, like a formatter, a build, another editor or a checkout. The room still holds its text, and opening the file again brings it in.`;
    case 'not-permitted':
      return `${path} could not be written: this page no longer has write access to the folder. Grant it again from the address bar, or keep the room\u2019s text with Download.`;
  }
}

/**
 * Whether this browser can hand a page a folder at all.
 *
 * The test is the picker's presence and nothing weaker: Firefox (111+) and Safari (15.2+) do
 * implement the handle interfaces for their own origin-private file system, so a feature test
 * that looked for `getFileHandle` would offer hosting and then fail at the click.
 */
export function folderPickerOf(scope: object): PickFolder | undefined {
  const picker = (scope as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  return typeof picker === 'function' ? (picker as PickFolder) : undefined;
}

/**
 * Asks for a folder, mapping every outcome to a sentence the card can carry.
 *
 * The picker needs transient user activation, so this is only ever called from a click; a page
 * that ran it on load would be refused, not prompted.
 */
export async function pickFolder(picker: PickFolder | undefined): Promise<FolderPick> {
  if (picker === undefined) {
    return { kind: 'refused', cause: 'unsupported', sentence: folderPickSentence('unsupported') };
  }
  try {
    const handle = await picker(FOLDER_PICKER_OPTIONS);
    return { kind: 'picked', folder: new FolderWorkingCopy(handle) };
  } catch (error: unknown) {
    const name = errorName(error);
    if (name === 'AbortError') {
      return { kind: 'cancelled' };
    }
    return { kind: 'refused', cause: 'refused', sentence: folderPickSentence('refused', name) };
  }
}

/**
 * This page's folder, as the shared walk's seam: each call is one of the five the rule makes, in the
 * File System Access API's own words.
 *
 * The entry type is the API's own `kind`, which is `'file'` or `'directory'` and nothing else — a
 * browser neither lists nor follows a symbolic link — so nothing here is ever `other`.
 *
 * `rootIgnores` is handed the root's own entries, which the walk has just read, so the folder is
 * listed once per walk; `.git` and `info` are different directories from it.
 *
 * The names the walk refuses are the shared rule's, and it reads a host platform from `process`:
 * a page has none, so the walk folds case, which excludes more rather than less.
 */
const FOLDER_SOURCE: ListingWalkSource<FolderDirectoryHandle> = {
  entries: (dir) => listingOf(dir),
  ignoreText: (dir, entries) => ignoreFileIn(dir, entries, IGNORE_FILE),
  shareable: (dir, name) => shareableFile(dir, name),
  child: (dir, name) => childOf(dir, name),
  rootIgnores: (dir, entries) => rootIgnores(dir, entries),
};

/**
 * A folder as the room's working copy: its listing, a read for a peer's request, and the write
 * of the text the room settled on — behind the stale-file guard.
 *
 * The stamps map is the whole memory the guard has: after every read and every write of a path
 * the page saw that file's `lastModified`, and a write is refused unless the file still carries
 * it. There is no watcher in the API to rely on (Firefox and Safari have none, Chromium's
 * `FileSystemObserver` is experimental and off the standards track), so this is the one check
 * the platform affords.
 */
export class FolderWorkingCopy implements FolderWork {
  private readonly handle: FolderDirectoryHandle;
  private readonly stamps = new Map<string, number>();
  /** The line ending and BOM each read path's bytes had, read beside the stamp for the same reason. */
  private readonly layouts = new Map<string, FileLayout>();
  /**
   * The paths the last {@link list} offered the room, or `undefined` before the first walk.
   *
   * Once the folder has been listed, a read serves those paths and nothing else. The shared
   * excludes are a list of names the room must never see, and no such list is complete: a
   * `.env.production`, a `.netrc` or a file past the walk's budget passes it. The listing is
   * the set of names the host saw offered, so it is what a peer's request is held to. The
   * protocol leaves the host free to decline a path (`PROTOCOL.md` §6.3, §12), and a peer's
   * `doc.open` for a name outside the listing is still carried; it just finds no text here.
   */
  private listed: ReadonlySet<string> | undefined;
  /**
   * The bound the last {@link list} stopped at, or `undefined` when it read the whole folder.
   *
   * A walk that stopped short is a fact about the folder rather than about the listing, and the page
   * is the one that says it: without this the person sharing a folder the room only holds part of is
   * told nothing at all.
   */
  private cut: FolderCut | undefined;
  /**
   * Every directory the last walk entered, ascending.
   *
   * Held apart from the listing, which is files: a directory is in a listing only through the files
   * inside it, so a folder holding none is a folder no listing names at all (`emptyFolders`).
   */
  private folders: readonly string[] = [];

  constructor(handle: FolderDirectoryHandle) {
    this.handle = handle;
  }

  /** The folder's own name, for the card and the notes. */
  get name(): string {
    return this.handle.name;
  }

  /** The stamp the last read or write of `path` saw, or `undefined` when there is none. */
  stampOf(path: string): number | undefined {
    return this.stamps.get(path);
  }

  /**
   * How `path`'s bytes are laid out, from the last read of it, or `undefined` for a path this
   * window has not read: a buffer built from the replica is rendered with this ending, and a write
   * puts this byte order mark back.
   */
  layout(path: string): FileLayout | undefined {
    return this.layouts.get(path);
  }

  /**
   * The folder's listing: files only, ascending by UTF-16 code unit, the paths the shared rule
   * shares. A directory that cannot be listed is one this host cannot share and is left out
   * whole rather than failing the walk, because a grant is a listing and not a promise.
   *
   * The walk itself is the bridge's (`walkListing`), which is the whole of why this page shares
   * the same files the desktop clients do: the bounds, the charge points and the cut reason do not
   * vary with the editor. What is here is the folder's half — `FileSystemDirectoryHandle`, and the
   * folder's own ignore sources.
   */
  async list(): Promise<string[]> {
    const result = await walkListing(FOLDER_SOURCE, [{ dir: this.handle, name: this.name }]);
    this.listed = new Set(result.paths);
    this.folders = result.entered.sort();
    this.cut = result.cut;
    return result.paths;
  }

  /**
   * Whether the last walk stopped short of the folder, and which bound stopped it.
   *
   * One fact in two shapes: a caller that only says it happened reads the first, and one that says
   * which bound it was reads the second.
   */
  listingWasCut(): boolean {
    return this.cut !== undefined;
  }

  listingCut(): FolderCut | undefined {
    return this.cut;
  }

  /**
   * The folders the last walk entered that hold no shared file.
   *
   * A room's listing is files, so a directory is in one only through the files inside it — which
   * leaves a folder holding none in nothing the page knows. The tree draws the empty folders *this
   * session* made from its own memory, and a page that has just loaded has none: a folder the person
   * made last time is then on disk, in no listing, and drawn nowhere, while a move onto its name is
   * refused against it. So the walk keeps the directories it entered and this reads back the ones no
   * listed path goes through.
   *
   * A directory whose own name the grant's rules exclude is not among them: it is left out of the
   * walk whole, and a folder this page may not name is not one it may offer as a row.
   */
  emptyFolders(): string[] {
    const known = this.listed;
    if (known === undefined) {
      return [];
    }
    // Every directory a listed file goes through holds that file. Marking them from the files, one
    // ancestor at a time, is what a per-directory descendant scan would say, without the scan.
    const holds = new Set<string>();
    for (const path of known) {
      let at = folderOf(path);
      while (at !== '' && !holds.has(at)) {
        holds.add(at);
        at = folderOf(at);
      }
    }
    return this.folders.filter((folder) => !holds.has(folder));
  }

  /**
   * A file's text, or why the room has none: the path is one a peer named, so the shared
   * excludes are applied to it before anything is resolved, and once the folder has been
   * listed, a path the listing did not offer is refused the same way. The folder's own ignore
   * files bind it too, because what the listing leaves out is not this host's to serve either.
   *
   * A successful read records the file's stamp, which is what the write guard compares against.
   */
  async read(path: string): Promise<GrantedRead> {
    const unlisted = this.listed !== undefined && !this.listed.has(path);
    if (unlisted || !isGrantedPath(path, FOLDER_PLATFORM)) {
      return { kind: 'refused', cause: 'not-granted' };
    }
    const dir = await this.directoryOf(path);
    if ('cause' in dir) {
      return { kind: 'refused', cause: dir.cause };
    }
    let handle: FolderFileHandle;
    try {
      handle = await dir.handle.getFileHandle(leafOf(path));
    } catch (error: unknown) {
      return { kind: 'refused', cause: namedRefusal(error) };
    }
    let file: FolderFile;
    try {
      file = await handle.getFile();
    } catch (error: unknown) {
      return { kind: 'refused', cause: namedRefusal(error) };
    }
    // The check follows the name's resolution, so a path that is not there keeps `missing`, and a
    // path that is there and the folder's ignore files leave out is refused `not-granted`, the
    // silent no an excluded name gets, which says nothing about whether a guess was worth making.
    if (isIgnoredPath(await this.governingIgnores(path), path, false, FOLDER_PLATFORM)) {
      return { kind: 'refused', cause: 'not-granted' };
    }
    if (file.size > MAX_GRANT_FILE_BYTES) {
      return { kind: 'refused', cause: 'too-large' };
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error: unknown) {
      return { kind: 'refused', cause: namedRefusal(error) };
    }
    const text = decodableText(bytes);
    if (text === undefined) {
      return { kind: 'refused', cause: 'binary' };
    }
    this.stamps.set(path, file.lastModified);
    this.layouts.set(path, { eol: eolOf(text), bom: hasByteOrderMark(bytes) });
    return { kind: 'text', text };
  }

  /**
   * The ignore sources that govern `path`: `<folder>/.git/info/exclude` first, then the `.gitignore`
   * of every directory from the folder down to the one holding `path`, lowest precedence first.
   *
   * Each `.gitignore` is read only where the directory that holds it lists it as an ordinary file,
   * and each step down is a name the directory before it lists as an ordinary directory, so the
   * sources come from directories the path's own resolution accepted. Nothing above the folder is
   * read.
   */
  private async governingIgnores(path: string): Promise<IgnoreSource[]> {
    // The root's own listing is read here and handed to `rootIgnores`, which together with each
    // step below reads every directory on the way exactly once.
    let entries = await listingOf(this.handle);
    const sources = await rootIgnores(this.handle, entries ?? []);
    const segments = path.split('/');
    segments.pop();
    let dir = this.handle;
    for (let depth = 0; depth <= segments.length; depth += 1) {
      if (entries === undefined) {
        break;
      }
      const relative = segments.slice(0, depth).join('/');
      const own = await ignoreFileIn(dir, entries, IGNORE_FILE);
      if (own !== undefined) {
        sources.push({ dir: relative, text: own });
      }
      if (depth === segments.length) {
        break;
      }
      const name = segments[depth] ?? '';
      if (!entries.some((entry) => entry.name === name && entry.kind === 'directory')) {
        break;
      }
      const below = await childOf(dir, name);
      if (below === undefined) {
        break;
      }
      dir = below;
      entries = await listingOf(dir);
    }
    return sources;
  }

  /**
   * Writes the text the room settled on, unless the file moved underneath the page.
   *
   * The order is the guard: the file's stamp now must be the stamp this page last saw for the
   * path, and a path this page never read is refused as `unread` rather than written — the room
   * holds text for a path only because the host read that path off this disk, so a write with
   * no read behind it would overwrite a file nothing here has looked at. A misbehaving caller
   * therefore loses nothing, and this host never creates a file: `getFileHandle` is only ever
   * called for a name the listing already named.
   *
   * What the file's own bytes decide is put back on the way in: the byte order mark the read
   * stripped, and nothing else. The line ending is the buffer's (`editor.ts` builds a model worn by
   * the ending this module recorded), so the text arrives already carrying it.
   *
   * What this cannot promise, and does not: `getFile()` and `createWritable()` are two steps,
   * and a change landing between them is not caught. The guard turns the overwrite a person
   * would never hear about into a refusal that names the file; it is not an atomic compare and
   * swap, because the API has none.
   *
   * The stamp is the file's modification time, and that is as far as the guard reaches: a writer
   * that puts the old stamp back — `cp -p`, `rsync -a`, `tar -x`, a `git` with
   * `core.restoreMtime` — leaves it identical, and the room's text then lands on top of what was
   * written. That is a deploy step or a formatter that preserves times, not the ordinary edit
   * this guard is for, and the platform gives no identity that survives it: the alternatives are
   * a content hash read on every write, or a compare-and-swap the API does not have. This is a
   * residual of the platform, stated rather than covered.
   */
  async write(path: string, text: string): Promise<FolderWrite> {
    const refuse = (cause: FolderWriteRefusal): FolderWrite => ({
      kind: 'refused',
      cause,
      sentence: folderWriteSentence(cause, path),
    });
    if (!isGrantedPath(path, FOLDER_PLATFORM)) {
      return refuse('not-granted');
    }
    const seen = this.stamps.get(path);
    if (seen === undefined) {
      return refuse('unread');
    }
    const dir = await this.directoryOf(path);
    if ('cause' in dir) {
      return refuse(dir.cause === 'not-a-file' ? 'not-a-file' : 'missing');
    }
    let handle: FolderFileHandle;
    let file: FolderFile;
    try {
      handle = await dir.handle.getFileHandle(leafOf(path));
      file = await handle.getFile();
    } catch (error: unknown) {
      const cause = refusalOf(error);
      if (cause === undefined) {
        throw error;
      }
      return refuse(cause === 'not-a-file' ? 'not-a-file' : 'missing');
    }
    // The guard: the file the room read is the file this write lands in, or nothing is written.
    if (file.lastModified !== seen) {
      return refuse('stale');
    }
    let writable: FolderWritable;
    try {
      writable = await handle.createWritable();
    } catch (error: unknown) {
      // The two a person can act on are named; anything else is thrown, because a guess at what
      // an unknown failure meant is a sentence that sends them looking in the wrong place.
      if (permissionRefusal(error)) {
        return refuse('not-permitted');
      }
      const cause = refusalOf(error);
      if (cause === undefined) {
        throw error;
      }
      return refuse(cause === 'not-a-file' ? 'not-a-file' : 'missing');
    }
    try {
      // The bytes the file had, not the bytes a decoder produced: a BOM the reader stripped goes back
      // with the text, so an edit of one character does not delete it.
      await writable.write(withByteOrderMark(text, this.layouts.get(path)?.bom === true));
      await writable.close();
    } catch (error: unknown) {
      await abortQuietly(writable);
      throw error;
    }
    // The write replaced the file, so the stamp to compare against next time is the new one.
    // A file that cannot be re-read after the write keeps the stamp it had, and the next write
    // is refused as stale rather than clobbering whatever arrived in between.
    try {
      this.stamps.set(path, (await handle.getFile()).lastModified);
    } catch {
      this.stamps.set(path, seen);
    }
    return { kind: 'written' };
  }

  /**
   * Takes one entry out of the folder: a file, or a folder with everything inside it.
   *
   * The path is walked one segment at a time, as every other operation here walks it, and the shared
   * rule decides the name before anything is resolved — so a `..`, an absolute path or an excluded
   * name never reaches the API at all, and this cannot name anything outside the folder the person
   * picked. What it does inside that folder is the API's own removal, with the recursive flag the
   * only kind of removal a folder has.
   *
   * Recursion is the API's, and it cannot walk out of the grant through a link: the folder the
   * person picked *is* the boundary (this module holds one directory handle and reaches nothing
   * else), and Chromium does not list a symbolic link at all (see `refusalOf`), so there is no
   * listed entry whose removal follows a path this page was never handed.
   *
   * What the removal takes out of this module's own memory is the stamp and the layout of every path
   * that went, and those paths out of the set a read is served from: a stamp left behind would be a
   * write guard comparing against a file that is not there.
   */
  async remove(path: string): Promise<FolderRemove> {
    const refuse = (cause: FolderRemoveRefusal): FolderRemove => ({
      kind: 'refused',
      cause,
      sentence: folderRemoveSentence(cause, path),
    });
    if (!isGrantedPath(path, FOLDER_PLATFORM)) {
      return refuse('not-granted');
    }
    // A path already gone is the end the person asked for, so it is removed like any other: the
    // listing that still showed it is what is out of date.
    const dir = await this.directoryOf(path);
    if ('cause' in dir) {
      if (dir.cause === 'not-granted') {
        return refuse('not-permitted');
      }
      return { kind: 'removed', path, paths: this.forget(path) };
    }
    try {
      await dir.handle.removeEntry(leafOf(path), { recursive: true });
    } catch (error: unknown) {
      if (permissionRefusal(error)) {
        return refuse('not-permitted');
      }
      const cause = refusalOf(error);
      if (cause === undefined) {
        throw error;
      }
      if (cause === 'not-granted') {
        return refuse('not-permitted');
      }
    }
    return { kind: 'removed', path, paths: this.forget(path) };
  }

  /**
   * Moves a file or a folder to another name.
   *
   * A file is a write at the new path and then a removal at the old (`moveFile`). A folder is its
   * whole contents: every listed file inside it moves the same way, one at a time, and the folder
   * itself follows once nothing is left in it (`moveFolder`). What the path actually is comes from
   * the folder rather than from the listing, because a listing is files (`moveSource`).
   *
   * What this cannot promise, and does not: a move is many steps rather than one, so a refusal
   * partway leaves the folder at both names, reported as `partial`. And a room carries a folder only
   * through the files its listing has in it, so an entry no listing carries — an exclude such as
   * `.git`, a binary, a file over the size a room will carry — cannot travel with the move; a folder
   * holding one is refused up front rather than half-moved and then emptied of it (`unsharedUnder`).
   */
  async move(from: string, to: string): Promise<FolderMove> {
    const refuse = (cause: FolderMoveRefusal): FolderMove => ({
      kind: 'refused',
      cause,
      sentence: folderMoveSentence(cause, from, to),
    });
    if (!isGrantedPath(from, FOLDER_PLATFORM) || !isGrantedPath(to, FOLDER_PLATFORM)) {
      return refuse('not-granted');
    }
    if (from === to) {
      return refuse('same');
    }
    const source = await this.moveSource(from);
    if (source.kind === 'refused') {
      return refuse(source.cause);
    }
    return source.kind === 'directory'
      ? this.moveFolder(from, to, source.handle, (cause, detail) => ({
          kind: 'refused',
          cause,
          sentence: folderMoveSentence(cause, from, to, detail),
        }))
      : this.moveFile(from, to, refuse);
  }

  /**
   * What `path` is in the folder the person picked, asked of the folder itself.
   *
   * The listing cannot answer it: a listing is files, so a folder is in one only through the files
   * inside it, and a folder this session made and wrote nothing into is in no listing at all. The
   * lookup asks for a directory, so a name that is there as a file answers `TypeMismatchError` —
   * the one answer here that is a fact about the path and not about the move.
   */
  private async moveSource(path: string): Promise<MoveSource> {
    const dir = await this.directoryOf(path);
    if ('cause' in dir) {
      return { kind: 'refused', cause: dir.cause === 'not-granted' ? 'not-permitted' : dir.cause };
    }
    try {
      return { kind: 'directory', handle: await dir.handle.getDirectoryHandle(leafOf(path)) };
    } catch (error: unknown) {
      if (permissionRefusal(error)) {
        return { kind: 'refused', cause: 'not-permitted' };
      }
      const cause = refusalOf(error);
      if (cause === undefined) {
        throw error;
      }
      return cause === 'not-a-file' ? { kind: 'file' } : { kind: 'refused', cause };
    }
  }

  /**
   * Moves one file to another name: a write at the new path, then a removal at the old.
   *
   * That is the whole of what moving a file is here, and the order is what makes each step honest.
   * The old text is read first, so a file that is not there, is not text or is over the bound is
   * refused before anything is made. The new name is created, which refuses a name the folder
   * already holds rather than merging the two. Then the text is written, and only then is the old
   * path removed — a removal first would lose a file whose write was refused. The directories a
   * path goes through are made on the way down for a file inside a folder being moved, which is what
   * `create`'s own `createDirectories` is for, and not for a file moved to a name typed at the top
   * level, where a missing one means the person mistyped.
   *
   * What this is not: a rename. The file's identity is its path in this client too, and the caller is
   * the one that decides a path may change at all (the page settles the documents the room holds
   * open first, because the room keys a document by its path).
   *
   * What it cannot promise: the write and the removal are two steps, so a removal refused after the
   * write landed leaves the file at both names, reported as `partial` rather than as a move that did
   * not happen or one that did. The path it carries for the page is then nothing: the old document
   * still describes the old name, which is still there.
   */
  private async moveFile(
    from: string,
    to: string,
    refuse: (cause: FolderMoveRefusal) => FolderMove,
    options: { createDirectories?: boolean } = {},
  ): Promise<FolderMove> {
    const source = await this.read(from);
    if (source.kind === 'refused') {
      return refuse(source.cause);
    }
    const made = await this.create(to, 'file', options);
    if (made.kind === 'refused') {
      return this.destinationRefusal(made.cause, from, to);
    }
    // The layout travels with the text. `create` stamped the new file and knows nothing about how the
    // old one's bytes were laid out, so the byte order mark has to be carried here or the move would
    // quietly strip it (`write` puts it back only for a path this module has a layout for).
    const layout = this.layouts.get(from);
    if (layout !== undefined) {
      this.layouts.set(to, layout);
    }
    const written = await this.write(to, source.text);
    if (written.kind === 'refused') {
      // The copy never landed, and the create above made an empty file: it goes, so the folder is as
      // it was and the refusal is a refusal and not a half-move.
      await this.remove(to);
      return refuse(written.cause);
    }
    const gone = await this.remove(from);
    if (gone.kind === 'refused') {
      return { kind: 'partial', from, to, paths: [], sentence: folderMovePartialSentence(from, to, gone.sentence) };
    }
    return { kind: 'moved', from, to, paths: [from] };
  }

  /**
   * Moves a folder: every listed file inside it, one at a time, and then the folder itself.
   *
   * The order is what makes a move that stops halfway readable rather than destructive. Each file
   * lands before the folder is taken out, and the folder goes only once its contents have: what has
   * not moved is still where it was, and a refusal along the way is answered with the folder at both
   * names rather than with a folder that half arrived.
   *
   * The folder is refused before anything is made when it holds a file the room's listing has no
   * path for (`unsharedUnder`). The removal that ends the move is the recursive one, which takes
   * with it everything in the folder and not only the files that were listed; the check is what
   * makes that removal safe, and it is made before the first byte moves rather than after.
   */
  /**
   * A refusal about the destination, in a create's own words.
   *
   * What failed is making `to`, not finding `from`: the folder a path goes through is not there, or
   * the name is already held. Wording it as a move's refusal of the source says the folder the person
   * picked up is not in the folder any more, which sends them to look at the one they are holding
   * rather than the one they dropped it on.
   */
  private destinationRefusal(
    cause: FolderCreateRefusal,
    from: string,
    to: string,
  ): FolderMove {
    if (cause === 'exists') {
      // A create's own words for this are about a name somebody typed, and a move has no field to
      // type one in: the sentence says what the folder did rather than what to try next.
      return {
        kind: 'refused',
        cause,
        sentence: `${from} was not moved: ${to} is already in that folder, and this page replaces and renames nothing the folder holds.`
      };
    }
    return {
      kind: 'refused',
      cause,
      sentence: `${from} was not moved: ${folderCreateSentence(cause, to)}`,
    };
  }

  private async moveFolder(
    from: string,
    to: string,
    handle: FolderDirectoryHandle,
    refuse: (cause: FolderMoveRefusal, detail?: string) => FolderMove,
  ): Promise<FolderMove> {
    const under = `${from}/`;
    if (to.startsWith(under)) {
      return refuse('inside');
    }
    const dirs: string[] = [];
    const stranger = await this.unsharedUnder(handle, from, dirs);
    if (stranger !== undefined) {
      return refuse('unshared', stranger);
    }
    const made = await this.create(to, 'directory');
    if (made.kind === 'refused') {
      return this.destinationRefusal(made.cause, from, to);
    }
    // What a move that gives up before anything landed takes back out: the folder it made at the other
    // end. An empty folder left where nothing arrived is a row nobody asked for — and, a listing being
    // files, one nothing draws, which is a name the next move onto it is refused against.
    const abandon = (): Promise<FolderRemove> => this.remove(to);
    // The folders arrive too, shallowest first, before the files that go in them. A room's listing
    // cannot carry a directory — it is files — so the walk above is the only thing that knows one was
    // there, and a move that left them behind would have the source removal take them with it: an
    // empty folder inside a folder the person moved is theirs, and `mv` keeps it.
    for (const dir of dirs) {
      const at = `${to}${dir.slice(from.length)}`;
      const madeDir = await this.create(at, 'directory', { createDirectories: true });
      if (madeDir.kind === 'refused') {
        await abandon();
        return this.destinationRefusal(madeDir.cause, from, at);
      }
    }
    const moving = [...(this.listed ?? [])].filter((path) => path.startsWith(under)).sort();
    const moved: string[] = [];
    for (const path of moving) {
      const at = `${to}${path.slice(from.length)}`;
      const landed = await this.moveFile(path, at, (cause) => ({
        kind: 'refused',
        cause,
        sentence: folderMoveSentence(cause, path, at),
      }), { createDirectories: true });
      if (landed.kind !== 'moved') {
        // Nothing has moved when the first file is refused, so that is a move that did not happen;
        // a refusal after one has landed is a half-done move, and is said as one.
        if (landed.kind === 'refused' && moved.length === 0) {
          await abandon();
          return landed;
        }
        return { kind: 'partial', from, to, paths: moved, sentence: folderMovePartialSentence(from, to, landed.sentence) };
      }
      moved.push(path);
    }
    const gone = await this.remove(from);
    if (gone.kind === 'refused') {
      return { kind: 'partial', from, to, paths: moved, sentence: folderMovePartialSentence(from, to, gone.sentence) };
    }
    return { kind: 'moved', from, to, paths: moved };
  }

  /**
   * The first file under a folder that the room's listing has no path for, or `undefined` when
   * every file in it is one the listing carries.
   *
   * A raw walk, because this answers what a recursive removal would take with it: the excludes are a
   * list of names a room must never see at all, the listing's own walk leaves out a name that
   * declares a format a room cannot carry and one over the size it carries, and a subtree can fall
   * outside the walk's budget. Each of those is a file the folder holds and the listing does not.
   *
   * Every directory it walks is left in `dirs`, shallowest first, which is what the move makes at
   * the other end: a room's listing is files, so a directory is in none, and the source removal is
   * recursive — one it did not make would be taken by the removal rather than moved.
   *
   * A directory it cannot descend into is answered as the stranger itself: a move may not remove
   * what nothing here has read.
   */
  private async unsharedUnder(
    dir: FolderDirectoryHandle,
    path: string,
    dirs: string[],
  ): Promise<string | undefined> {
    const entries = await listingOf(dir);
    if (entries === undefined) {
      return path;
    }
    for (const entry of entries) {
      const child = `${path}/${entry.name}`;
      if (entry.kind === 'file') {
        if (this.listed?.has(child) !== true) {
          return child;
        }
        continue;
      }
      let handle: FolderDirectoryHandle;
      try {
        handle = await dir.getDirectoryHandle(entry.name);
      } catch {
        return child;
      }
      dirs.push(child);
      const under = await this.unsharedUnder(handle, child, dirs);
      if (under !== undefined) {
        return under;
      }
    }
    return undefined;
  }

  /**
   * Forgets one path and everything under it: the stamps, the layouts, and the listed set.
   *
   * What it returns is the listed files that went, which is the page's answer to "which documents do
   * I have that no longer exist". A folder is in a listing only through the files inside it, so a
   * folder's own path is returned only when nothing had been listed — and then it names no document.
   */
  private forget(path: string): string[] {
    const under = `${path}/`;
    const known = this.listed;
    const gone = known === undefined ? [path] : [...known].filter((seen) => seen === path || seen.startsWith(under));
    this.stamps.delete(path);
    this.layouts.delete(path);
    if (known !== undefined) {
      this.listed = new Set([...known].filter((seen) => seen !== path && !seen.startsWith(under)));
    }
    for (const seen of gone) {
      this.stamps.delete(seen);
      this.layouts.delete(seen);
    }
    return gone;
  }

  /**
   * Creates one file or one directory at a path a person typed, and refuses rather than adopting
   * what is already there.
   *
   * The path is walked one segment at a time, as every other operation here walks it: the shared
   * rule decides the name before anything is resolved, each segment the path goes through has to be
   * a directory of the folder, and only the last segment is made — with the API's own create.
   *
   * `createDirectories` decides what a path through a directory that is not there means. On, the
   * segments are made on the way down, which is what a file typed as `docs/intro.md` needs: a
   * directory that holds nothing is in nobody's listing — a room's listing is files — so the
   * ordinary way to add a folder to a room is to add a file inside it, and a page that refused the
   * path would be asking for an act it offers no way to take. Off, the walk stops at the missing
   * segment and refuses it (`missing`), which is the rule a name typed into the wrong folder is
   * caught by. The row's own live check previews both cases, so a commit is never where a person
   * first learns the folder will be made (`new-entry.ts`).
   *
   * A created file is stamped from its own read-back, and that is load-bearing: the write guard
   * refuses a path this page has no stamp for (`unread`), and a file this page has just made must
   * be writable rather than unreachable. The path also joins the set a read is served from, so the
   * listing the caller publishes a moment later and this module's own memory agree.
   *
   * What this cannot promise: the probe for an existing name and the create are two steps and the
   * API has no exclusive create, so an entry that appears between them is adopted rather than
   * replaced. Nothing is written by the create itself, and the read-back is a read like any other.
   * A symbolic link is not a case here: Chromium answers `NotFoundError` for one (see `refusalOf`),
   * so a create over a link's name makes a plain file beside it.
   */
  async create(
    path: string,
    entry: NewEntryKind,
    options: { createDirectories?: boolean } = {},
  ): Promise<FolderCreate> {
    const refuse = (cause: FolderCreateRefusal): FolderCreate => ({
      kind: 'refused',
      cause,
      sentence: folderCreateSentence(cause, path),
    });
    if (!isGrantedPath(path, FOLDER_PLATFORM)) {
      return refuse('not-granted');
    }
    if (entry === 'file' && isBinaryNamedPath(path)) {
      return refuse('binary');
    }
    const dir = await this.directoryOf(path, options.createDirectories === true);
    if ('cause' in dir) {
      if (dir.cause === 'not-a-file') {
        return refuse('not-a-file');
      }
      // The walk reports a refusal about permission with the grant's own word for a name it will
      // not serve; here the name has already passed the shared rule, so it is the access that went.
      return refuse(dir.cause === 'not-granted' ? 'not-permitted' : 'missing');
    }
    const leaf = leafOf(path);
    let taken: boolean;
    try {
      taken = await this.present(dir.handle, leaf, entry);
    } catch (error: unknown) {
      if (permissionRefusal(error)) {
        return refuse('not-permitted');
      }
      throw error;
    }
    if (taken) {
      return refuse('exists');
    }
    let handle: FolderFileHandle | undefined;
    try {
      handle =
        entry === 'file'
          ? await dir.handle.getFileHandle(leaf, { create: true })
          : undefined;
      if (entry === 'directory') {
        await dir.handle.getDirectoryHandle(leaf, { create: true });
      }
    } catch (error: unknown) {
      if (permissionRefusal(error)) {
        return refuse('not-permitted');
      }
      const cause = refusalOf(error);
      if (cause === undefined) {
        throw error;
      }
      return refuse(cause === 'not-a-file' ? 'not-a-file' : 'missing');
    }
    if (handle !== undefined) {
      try {
        this.stamps.set(path, (await handle.getFile()).lastModified);
      } catch {
        // The entry is made and the stamp is not: an unstamped path is one the write guard refuses
        // (`unread`), which is the safe side of failing to look at a file that is now there.
      }
    }
    if (this.listed !== undefined) {
      this.listed = new Set([...this.listed, path]);
    }
    return { kind: 'created', path, entry };
  }

  /**
   * Whether a name is already taken in `dir`, asked without the API's create so the lookup cannot
   * make what it was only asked about. A name that is there as the other kind counts: this page
   * replaces nothing, and a create over it would be that replacement. A failure this module cannot
   * read is thrown rather than read as a free name.
   */
  private async present(
    dir: FolderDirectoryHandle,
    name: string,
    entry: NewEntryKind,
  ): Promise<boolean> {
    try {
      if (entry === 'file') {
        await dir.getFileHandle(name);
      } else {
        await dir.getDirectoryHandle(name);
      }
      return true;
    } catch (error: unknown) {
      const cause = refusalOf(error);
      if (cause === 'missing') {
        return false;
      }
      if (cause === 'not-a-file') {
        return true;
      }
      throw error;
    }
  }

  /**
   * The directory holding `path`, walked one segment at a time from the picked folder.
   *
   * With `create`, a segment that is not there is made on the way down — that is the whole of the
   * "a name may carry its own directories" rule — and a segment that is a file is still refused,
   * because making one over it would be the replacement this module never does.
   */
  private async directoryOf(
    path: string,
    create = false,
  ): Promise<{ handle: FolderDirectoryHandle } | { cause: GrantRefusal }> {
    const segments = path.split('/');
    let dir: FolderDirectoryHandle = this.handle;
    for (let index = 0; index < segments.length - 1; index += 1) {
      try {
        dir = await dir.getDirectoryHandle(segments[index] ?? '', create ? { create: true } : {});
      } catch (error: unknown) {
        return { cause: namedRefusal(error) };
      }
    }
    return { handle: dir };
  }
}

/**
 * A directory's entries, ascending by name, or `undefined` when this host cannot list it.
 *
 * The order is this module's own: a walk that stops at a bound must not let the file system's order
 * decide which paths survive it, and a refusal that names the first stranger under a folder must
 * name the same one twice.
 */
async function listingOf(dir: FolderDirectoryHandle): Promise<FolderEntry[] | undefined> {
  const entries: FolderEntry[] = [];
  try {
    for await (const entry of dir.values()) {
      entries.push({ name: entry.name, kind: entry.kind });
    }
  } catch {
    return undefined;
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return entries;
}

/**
 * Whether a listing holds `name` as exactly `kind`, by the type the directory itself reported and
 * never by a lookup: the File System Access API has no `lstat`, and a lookup answers what the name
 * is now rather than what the listing saw.
 */
function holdsKind(entries: readonly WalkEntry[], name: string, kind: WalkEntry['kind']): boolean {
  return entries.some((entry) => entry.name === name && entry.kind === kind);
}

/**
 * The ignore source that governs everything under the folder: `<folder>/.git/info/exclude`, the
 * lowest precedence source there is, under every `.gitignore` the walk reads below it.
 *
 * A folder need not be a repository, `.git` may be a file rather than a directory (a linked
 * worktree, a submodule), and a lookup may throw; each of those is a folder with no repository
 * exclude, which is what an absent one means. `.git` and `info` are read only where the directory
 * that holds each lists it as an ordinary directory, and `exclude` only where `info` lists it as an
 * ordinary file (`ignoreFileIn`), so a `.git` that is a link to a repository elsewhere cannot
 * supply rules here.
 *
 * `entries` is the root's own listing, which the walk that calls this has just read: the folder is
 * not listed a second time for its excludes, and `.git` and `info` are different directories.
 */
async function rootIgnores(
  root: FolderDirectoryHandle,
  entries: readonly WalkEntry[],
): Promise<IgnoreSource[]> {
  if (!holdsKind(entries, '.git', 'directory')) {
    return [];
  }
  const git = await childOf(root, '.git');
  if (git === undefined) {
    return [];
  }
  const held = await listingOf(git);
  if (held === undefined || !holdsKind(held, 'info', 'directory')) {
    return [];
  }
  const info = await childOf(git, 'info');
  if (info === undefined) {
    return [];
  }
  const text = await ignoreFileIn(info, undefined, EXCLUDE_FILE);
  return text === undefined ? [] : [{ dir: '', text }];
}

/**
 * The child directory `name` of `dir`, or `undefined` when the handle will not open it.
 *
 * The walk calls this only for an entry its own listing reported as a directory, so the entry type
 * is the check: a link, or a directory that is gone between the listing and this call, contributes
 * nothing.
 */
async function childOf(
  dir: FolderDirectoryHandle,
  name: string,
): Promise<FolderDirectoryHandle | undefined> {
  try {
    return await dir.getDirectoryHandle(name);
  } catch {
    return undefined;
  }
}

/**
 * Whether the leaf is a plain file small enough for one `Y.Text`. The walk reads no bytes to
 * decide this, so a binary whose name declares no format stays listed and is refused with the
 * truth when someone asks for it.
 */
async function shareableFile(dir: FolderDirectoryHandle, name: string): Promise<boolean> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return file.size <= MAX_GRANT_FILE_BYTES;
  } catch {
    return false;
  }
}

/**
 * The text of the ignore file `name` at `dir`, or `undefined` when no ignore file this host reads
 * is there.
 *
 * `name` counts only where the directory's own listing reports it as an ordinary file, never a
 * directory. The File System Access API offers no `lstat` and no `realpath`, so the `kind` of the
 * entry a directory enumerates is the whole of what this module can learn about what a name is; it
 * cannot tell a link from the file it points at. What keeps a linked `.gitignore` from supplying
 * rules is the API's own refusal, not a check here: Chromium neither lists a symbolic link nor
 * answers for one by name — `getFileHandle` throws `NotFoundError`, pinned by the suite's probe — so
 * a link never reaches this function as a file. The listing check is kept anyway, so the read is
 * bounded by the rule "only a name the directory itself listed" rather than by that behavior.
 *
 * What this cannot pin, stated rather than claimed: the structural handle interface does not carry
 * that refusal, because it is the implementation's and not the API's, so an implementation that
 * listed a link as a file would have its target's bytes read here (no `lstat` can tell); and a name
 * swapped for something else between the listing and the read is a second resolution of one name
 * this API cannot close, the same window the leaf read already has. Neither is reachable through
 * Chromium's own file access layer.
 *
 * A file larger than one this host shares is no ignore file either: a browser tab reads these bytes
 * into memory, and no `.gitignore` that large is a project's rule.
 *
 * `entries` is the directory's own listing when the caller already holds it, so a walk does not
 * read the same directory twice.
 */
async function ignoreFileIn(
  dir: FolderDirectoryHandle,
  entries: readonly WalkEntry[] | undefined,
  name: string,
): Promise<string | undefined> {
  const listing = entries ?? (await listingOf(dir));
  if (
    listing === undefined ||
    !listing.some((entry) => entry.name === name && entry.kind === 'file')
  ) {
    return undefined;
  }
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    if (file.size > MAX_GRANT_FILE_BYTES) {
      return undefined;
    }
    return decodableText(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return undefined;
  }
}

/** The last segment of a path that `isGrantedPath` has already accepted. */
function leafOf(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? '';
}

/** The directory a path sits in, or `''` for a path at the root of the folder. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * The refusal a `DOMException` names, in the bridge's own vocabulary, or `undefined` for a
 * failure this module cannot read as one of them.
 *
 * `NotFoundError` is the API's answer for a name that is not there — and, on the platforms
 * Chromium refuses, for a name that is a symbolic link, which its file access layer treats as a
 * hidden item rather than following it. `TypeMismatchError` is a name that is there and is not
 * the kind asked for. A refusal about permission is read as `not-granted` here; the caller that
 * is writing says it in its own words. Everything else is left unnamed on purpose: a guess at
 * what an unknown failure meant is a sentence that sends a person looking in the wrong place,
 * so it is thrown for the caller that can carry the browser's own words.
 */
function refusalOf(error: unknown): GrantRefusal | undefined {
  const name = errorName(error);
  if (name === 'NotFoundError') {
    return 'missing';
  }
  if (name === 'TypeMismatchError') {
    return 'not-a-file';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'not-granted';
  }
  return undefined;
}

/** A refusal this module recognises, or the failure itself when it does not. */
function namedRefusal(error: unknown): GrantRefusal {
  const cause = refusalOf(error);
  if (cause === undefined) {
    throw error;
  }
  return cause;
}

/** Whether an error is the browser refusing access rather than the file being absent. */
function permissionRefusal(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'InvalidStateError';
}

/**
 * The line ending a file's text uses. A file with mixed endings, or none, renders as LF: the
 * document's own ending is the first thing an editor normalises, and Monaco does the same.
 */
function eolOf(text: string): LineEnding {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Whether the bytes open with a UTF-8 byte order mark, which `decodableText` strips from the text. */
function hasByteOrderMark(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** The text as the file will carry it, with the byte order mark back where the read found one. */
function withByteOrderMark(text: string, bom: boolean): string {
  return bom && !text.startsWith('\uFEFF') ? `\uFEFF${text}` : text;
}

function errorName(error: unknown): string {
  const named = error as { name?: unknown } | undefined;
  return typeof named?.name === 'string' ? named.name : '';
}

async function abortQuietly(writable: FolderWritable): Promise<void> {
  try {
    await writable.abort?.();
  } catch {
    // The stream is already gone; the caller reports the write's own failure.
  }
}

/**
 * A file's text, or `undefined` when the bytes are not text a room can carry.
 *
 * The same rule the VS Code adapter applies to a file it reads off its disk: a document is one
 * `Y.Text`, so a NUL byte or a byte sequence that is not valid UTF-8 is not something to put in
 * one — a binary decoded into a string would be corrupted into replacement characters and the
 * room's own save policy would then write it back over the host's file. The size was checked
 * before the bytes were fetched, so this reads at most one `MAX_GRANT_FILE_BYTES` buffer.
 */
export function decodableText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) {
    return undefined;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
