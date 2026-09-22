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
 * Every handle here is structural (an interface with the four methods this module calls) rather
 * than `FileSystemDirectoryHandle`, so the suite drives the whole module with hand-built doubles
 * and no browser (§4.1 of the study).
 */

import {
  MAX_GRANT_FILE_BYTES,
  MAX_GRANT_PATHS,
  isBinaryNamedPath,
  isGrantedPath,
  sortGrant,
} from '../bridge/index.ts';
import type { GrantRefusal, GrantedRead } from '../bridge/index.ts';

/**
 * The platform handed to the shared exclusion rule: none. A browser knows neither the host
 * filesystem's case folding nor its separator conventions, and `isGrantedPath` reads an empty
 * platform as "unknown — fold", which excludes more rather than less.
 */
const FOLDER_PLATFORM = '';

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

/** One entry of a directory listing: the two fields the walk reads. */
export interface FolderEntry {
  readonly name: string;
  readonly kind: 'file' | 'directory';
}

export interface FolderDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterableIterator<FolderEntry>;
  getDirectoryHandle(name: string): Promise<FolderDirectoryHandle>;
  getFileHandle(name: string): Promise<FolderFileHandle>;
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
  /** The person dismissed the prompt. */
  | 'cancelled'
  /** The browser refused: not called from a user gesture, or a folder it will not hand over. */
  | 'refused';

export type FolderPick =
  | { kind: 'picked'; folder: FolderWorkingCopy }
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
      return 'This browser cannot hand a page a folder. Chrome and Edge can; Firefox and Safari cannot. Joining a room still works here — hosting one from this page needs a Chromium browser.';
    case 'cancelled':
      return 'No folder was chosen, so no room was started.';
    case 'refused':
      return `The browser would not hand over that folder${detail === '' ? '' : ` (${detail})`}. A folder it keeps for itself — a system folder, your home directory itself — cannot be shared.`;
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
  /** The file changed on disk since this page last read or wrote it. */
  | 'stale'
  /** The person revoked write access, or the folder moved with the tab open. */
  | 'not-permitted';

export type FolderWrite =
  | { kind: 'written' }
  | { kind: 'refused'; cause: FolderWriteRefusal; sentence: string };

/**
 * What the editor's host half needs of a working copy: a read for a path the room asked for,
 * and a write of the text the room settled on. Structural, so the binding's own tests drive it
 * with a double while `FolderWorkingCopy` is what the page hands over.
 */
export interface FolderWork {
  read(path: string): Promise<GrantedRead>;
  write(path: string, text: string): Promise<FolderWrite>;
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
      return `${path} is not in the folder any more, so nothing was written. If it was renamed or deleted, the room's text is the only copy left.`;
    case 'not-a-file':
      return `${path} is not a plain file in the folder any more, so nothing was written.`;
    case 'unread':
      return `${path} had not been read from the folder before this write, so it was left alone rather than overwritten with text this page never saw.`;
    case 'stale':
      return `${path} changed on disk since the room read it — something else wrote it (a formatter, a build, another editor, a checkout) — so it was left alone rather than overwritten. The room still holds the room's text; open the file again to bring it in.`;
    case 'not-permitted':
      return `${path} could not be written: this page no longer has write access to the folder. Grant it again from the address bar, or keep the room's text with Download.`;
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
      return { kind: 'refused', cause: 'cancelled', sentence: folderPickSentence('cancelled') };
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
   * The folder's listing: files only, ascending by UTF-16 code unit, the paths the shared rule
   * shares. A directory that cannot be listed is one this host cannot share and is left out
   * whole rather than failing the walk, because a grant is a listing and not a promise.
   */
  async list(): Promise<string[]> {
    const paths: string[] = [];
    const budget = { nodes: MAX_FOLDER_NODES };
    await this.walk(this.handle, '', paths, budget);
    return sortGrant(paths);
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
   * excludes are applied to it before anything is resolved.
   *
   * A successful read records the file's stamp, which is what the write guard compares against.
   */
  async read(path: string): Promise<GrantedRead> {
    if (!isGrantedPath(path, FOLDER_PLATFORM)) {
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
      return { kind: 'refused', cause: readRefusal(error) };
    }
    let file: FolderFile;
    try {
      file = await handle.getFile();
    } catch (error: unknown) {
      return { kind: 'refused', cause: readRefusal(error) };
    }
    if (file.size > MAX_GRANT_FILE_BYTES) {
      return { kind: 'refused', cause: 'too-large' };
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return { kind: 'refused', cause: 'missing' };
    }
    const text = decodableText(bytes);
    if (text === undefined) {
      return { kind: 'refused', cause: 'binary' };
    }
    this.stamps.set(path, file.lastModified);
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
   * What this cannot promise, and does not: `getFile()` and `createWritable()` are two steps,
   * and a change landing between them is not caught. The guard turns the overwrite a person
   * would never hear about into a refusal that names the file; it is not an atomic compare and
   * swap, because the API has none.
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
      const cause = readRefusal(error);
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
      return refuse(permissionRefusal(error) ? 'not-permitted' : 'missing');
    }
    try {
      await writable.write(text);
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

  /** The directory holding `path`, walked one segment at a time from the picked folder. */
  private async directoryOf(
    path: string,
  ): Promise<{ handle: FolderDirectoryHandle } | { cause: GrantRefusal }> {
    const segments = path.split('/');
    let dir: FolderDirectoryHandle = this.handle;
    for (let index = 0; index < segments.length - 1; index += 1) {
      try {
        dir = await dir.getDirectoryHandle(segments[index] ?? '');
      } catch (error: unknown) {
        return { cause: readRefusal(error) };
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
 * The read refusal a `DOMException` names, in the bridge's own vocabulary.
 *
 * `NotFoundError` is the API's answer for a name that is not there — and, on the platforms
 * Chromium refuses, for a name that is a symbolic link, which its file access layer treats as a
 * hidden item rather than following it. `TypeMismatchError` is a name that is there and is not
 * the kind asked for. A refusal that is about permission is read as `not-granted` here; the
 * caller that is writing says it in its own words.
 */
function readRefusal(error: unknown): GrantRefusal {
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
  return 'missing';
}

/** Whether an error is the browser refusing access rather than the file being absent. */
function permissionRefusal(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'InvalidStateError';
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
