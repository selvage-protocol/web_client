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
 */

import {
  MAX_GRANT_FILE_BYTES,
  MAX_GRANT_PATHS,
  isBinaryNamedPath,
  isGrantedPath,
  sortGrant,
} from '../bridge/index.ts';
import type { GrantRefusal, GrantedRead, LineEnding } from '../bridge/index.ts';

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
 * How many entries a walk will look at before it stops. The path count is the listing's own
 * bound; this is the one that keeps a directory with a hundred thousand entries in it from
 * costing a hundred thousand `getFile()` calls before anything is published. Same value and
 * same reasoning as the VS Code adapter's walk.
 */
export const MAX_FOLDER_NODES = 20_000;

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
      return 'This browser cannot hand a page a folder. Chrome and Edge can; Firefox and Safari cannot. Joining a room here still works.';
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
      return `${path} changed on disk since the room read it, so it was left alone rather than overwritten. Something else wrote it (a formatter, a build, another editor, a checkout); the room still holds its text, and opening the file again brings it in.`;
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
   */
  async list(): Promise<string[]> {
    const paths: string[] = [];
    const budget = { nodes: MAX_FOLDER_NODES };
    await this.walk(this.handle, '', paths, budget);
    const sorted = sortGrant(paths);
    this.listed = new Set(sorted);
    return sorted;
  }

  private async walk(
    dir: FolderDirectoryHandle,
    prefix: string,
    out: string[],
    budget: { nodes: number },
  ): Promise<void> {
    if (out.length >= MAX_GRANT_PATHS || budget.nodes <= 0) {
      return;
    }
    let entries: FolderEntry[];
    try {
      entries = await folderEntries(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_GRANT_PATHS || budget.nodes <= 0) {
        return;
      }
      budget.nodes -= 1;
      const child = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      // The excludes, and the unsafe-name rule, are the shared ones: a `.env`, a key, a
      // `.git` and a path that escapes the folder are the same names here as on the desktop.
      if (!isGrantedPath(child, FOLDER_PLATFORM)) {
        continue;
      }
      if (entry.kind === 'directory') {
        try {
          await this.walk(await dir.getDirectoryHandle(entry.name), child, out, budget);
        } catch {
          // Gone or unreadable between the listing and the descent.
        }
        continue;
      }
      // A file whose name declares a format a room cannot carry is left out: the read refuses
      // every one of them as `binary`, so naming it would offer a guest a file no fetch fills.
      if (isBinaryNamedPath(child)) {
        continue;
      }
      if (await this.shareable(dir, entry.name)) {
        out.push(child);
      }
    }
  }

  /**
   * Whether the leaf is a plain file small enough for one `Y.Text`. The walk reads no bytes to
   * decide this, so a binary whose name declares no format stays listed and is refused with the
   * truth when someone asks for it.
   */
  private async shareable(dir: FolderDirectoryHandle, name: string): Promise<boolean> {
    try {
      const file = await (await dir.getFileHandle(name)).getFile();
      return file.size <= MAX_GRANT_FILE_BYTES;
    } catch {
      return false;
    }
  }

  /**
   * A file's text, or why the room has none: the path is one a peer named, so the shared
   * excludes are applied to it before anything is resolved, and once the folder has been
   * listed, a path the listing did not offer is refused the same way.
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

/** A directory's entries in name order, so which paths survive a cap does not depend on the
 * filesystem's own order. */
async function folderEntries(dir: FolderDirectoryHandle): Promise<FolderEntry[]> {
  const entries: FolderEntry[] = [];
  for await (const entry of dir.values()) {
    entries.push({ name: entry.name, kind: entry.kind });
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return entries;
}

/** The last segment of a path that `isGrantedPath` has already accepted. */
function leafOf(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? '';
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
