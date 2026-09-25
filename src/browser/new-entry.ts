/**
 * Creating a file or a directory in the folder this window holds.
 *
 * A room's shape is what its host's folder holds, so a fresh room whose folder is empty is a dead
 * end: nothing can be opened, the editor stands read-only in front of nobody, and the tree says the
 * host has shared nothing. The way out is a create, which is a host-side act the folder walk then
 * publishes.
 *
 * Two halves live here, and they are separate on purpose. This module holds the *rules* — what a
 * typed name means, and the order the act runs in — as functions over strings, so the suite can pin
 * every sentence without a browser. The editable row that shows them is `tree-view.ts`'s, drawn
 * where the entry will appear.
 *
 * The rules are the same rules the folder applies, called rather than copied: the grant rule
 * (`isGrantedPath`), the binary-name rule and the listing all come from the layers that own them,
 * so a name the row accepts is a name the folder takes. What the row adds is *when* a person is
 * told: while they type, in the line under the field, rather than after a commit in a second
 * sentence. That line says one thing and only when there is something to say — what the name will
 * also make, or why it will not be made. A name this room can take needs no line at all: the
 * field, the `✓` beside it and the tree around them are the whole of it.
 */

import { isBinaryNamedPath, isGrantedPath } from '../bridge/index.ts';
import { FOLDER_PLATFORM } from './folder.ts';
import type { FolderCreate, NewEntryKind } from './folder.ts';

/** What a create needs of the folder it makes something in. */
export interface HostFolder {
  create(
    path: string,
    entry: NewEntryKind,
    options?: { createDirectories?: boolean },
  ): Promise<FolderCreate>;
  list(): Promise<string[]>;
}

/** The page's wiring for one create: the folder, the room's listing, and the way a file is opened. */
export interface CreateInFolder {
  folder: HostFolder;
  /** Publishes a listing the room is drawn from. Absent for a window that shares no folder. */
  publish?: (paths: readonly string[]) => Promise<void>;
  /** Opens a path, which is what makes a file's text reach the room. Not called for a directory. */
  open: (path: string) => Promise<void>;
}

/**
 * What became of a create: refused, made, or **made and then not finished**.
 *
 * The third is the one worth its own name. The entry is in the folder from the moment `create`
 * answers, so a failure after that is not a create that did not happen, and a row that said so
 * would be telling a person their file is missing while it sits in their folder — and a retry of
 * the same name would then answer `exists`, which reads as a contradiction rather than as the
 * truth. Each phase is reported as the phase it is.
 */
export type CreateOutcome = FolderCreate | { kind: 'incomplete'; path: string; sentence: string };

/** What a create that reached the folder but not the room says. */
export function listingNotPublishedSentence(path: string, reason: string): string {
  return `${path} is in the folder, but the room was not told the listing changed: ${reason}. The folder holds it, and the next listing this page publishes carries it.`;
}

/** What a created file that could not be opened says: the room has the path and not its text. */
export function createdFileNotOpenedSentence(path: string, reason: string): string {
  return `${path} is in the folder and the room lists it, but this page could not open it: ${reason}. Its text reaches the room when it is opened.`;
}

/**
 * The whole act, in the order that makes each step true: make it, re-walk, publish, open.
 *
 * A created file is opened because content arrives when a file is opened — a listed path nobody
 * opened reads empty to every guest. A directory is not: there is nothing to open, and the room
 * learns it when the first file inside it appears.
 *
 * A typed path may carry its own directories (`createDirectories`), for both kinds: an empty folder is
 * in nobody's listing, so `docs/intro.md` is how a person puts a folder into the room — and `docs/api`
 * is how they make one the same way their file explorer's own New Folder does. The row previews what
 * the commit will make, so the two layers tell one story: a promise the folder then refused would be
 * the row lying about what it was about to do.
 *
 * The two refusals are the folder's own sentence, returned untouched so the row says what the layer
 * said; a failure thrown by `create` is the layer's own and is left to the caller to word. The steps
 * after it are this act's, and each is reported as itself (`CreateOutcome`).
 */
export async function createInFolder(
  options: CreateInFolder,
  path: string,
  entry: NewEntryKind,
): Promise<CreateOutcome> {
  const outcome = await options.folder.create(path, entry, { createDirectories: true });
  if (outcome.kind === 'refused') {
    return outcome;
  }
  try {
    await options.publish?.(await options.folder.list());
  } catch (error: unknown) {
    return { kind: 'incomplete', path, sentence: listingNotPublishedSentence(path, describe(error)) };
  }
  if (outcome.entry === 'file') {
    try {
      await options.open(path);
    } catch (error: unknown) {
      return { kind: 'incomplete', path, sentence: createdFileNotOpenedSentence(path, describe(error)) };
    }
  }
  return outcome;
}

/** A failure's own words, which is what both phases above report beside the path. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The path a typed name asks for, or `undefined` when it names nothing.
 *
 * Trimmed, and trailing slashes dropped: the kind is the button that was pressed, so a slash a
 * person writes out of habit is noise rather than information. Everything else is left exactly as
 * typed, and the folder layer's own rule refuses what may not be shared — an absolute path, a `..`,
 * an excluded name — with the sentence that says so.
 */
export function newEntryPath(raw: string): string | undefined {
  const path = raw.trim().replace(/\/+$/, '');
  return path === '' ? undefined : path;
}

/** The directory a path sits in, or `''` for a path at the root. */
function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** What the row needs to know about the room it is creating in. */
export interface NewEntryContext {
  kind: NewEntryKind;
  /** The name typed into the row, exactly as typed. */
  raw: string;
  /** The directory the entry will appear in: `''` at the root, `src` under `src/`. */
  parent: string;
  /** The room's listing: the files the folder published. */
  listing: readonly string[];
  /**
   * The directories this session made that no listing carries.
   *
   * An empty directory is in no listing — a room's listing is files — so without this a host would
   * watch the folder it just made vanish from the tree, and the next create into it would be
   * refused as a path through something that is not there. The page remembers what it made for the
   * session and hands it here (`main.ts`).
   */
  localFolders: ReadonlySet<string>;
}

/** What the row shows under its field, and what a commit would make. */
export interface NewEntryCheck {
  /**
   * The line under the field: why the name will not commit, or what a commit would also make.
   * Empty — no line at all — while the name is one this room can take.
   */
  line: string;
  /** Whether the line is a refusal. The field turns destructive and `✓` disables. */
  error: boolean;
  /** The path a commit would make, or `undefined` while the field names nothing usable. */
  path: string | undefined;
}

/**
 * What a typed name means, checked while it is typed.
 *
 * Local rules only — the grant rule, the binary rule and the listing — so the answer is immediate
 * and needs no folder. The folder's own `create` stays the authority on commit, and the two cases it
 * can see and this cannot (a directory that is not in the listing, a permission that has gone) are
 * reported in this same line with the folder's own sentence when the commit lands.
 *
 * The checks are ordered so the most specific true thing is said: what may not be shared at all,
 * then a format the room cannot carry, then the name being taken, then the path going through a
 * file, and last the neutral note that the path will make its own directories.
 */
export function checkNewEntry(context: NewEntryContext): NewEntryCheck {
  const typed = newEntryPath(context.raw);
  if (typed === undefined) {
    return { line: '', error: false, path: undefined };
  }
  const path = context.parent === '' ? typed : `${context.parent}/${typed}`;
  const refuse = (line: string): NewEntryCheck => ({ line, error: true, path: undefined });

  if (!isGrantedPath(path, FOLDER_PLATFORM)) {
    return refuse(`${path} is not a path this room shares.`);
  }
  if (context.kind === 'file' && isBinaryNamedPath(path)) {
    return refuse(`${path} declares a format a room cannot carry. Name a text file.`);
  }
  if (isTaken(path, context)) {
    return refuse(`${path} is already in the folder. Pick another name.`);
  }
  const through = fileOnTheWay(path, context.listing);
  if (through !== undefined) {
    return refuse(`${through} is a file, not a folder.`);
  }
  const missing = missingFolders(path, context);
  if (missing.length > 0) {
    const named = missing.map((folder) => `${folder}/`).join(' and ');
    return {
      line: `Also creates the ${missing.length === 1 ? 'folder' : 'folders'} ${named}.`,
      error: false,
      path,
    };
  }
  return { line: '', error: false, path };
}

/**
 * Whether the name is already taken, by either kind.
 *
 * A name is taken by a path the listing carries, by a directory this session made, and by any
 * listed path that goes through it — which is the only way a listing of files can say that a
 * directory exists, and it is the same answer for either kind: a file cannot be made where a
 * directory is, and a directory cannot be made where a file is. This page replaces nothing, and a
 * create over a name would be that replacement.
 */
function isTaken(path: string, context: NewEntryContext): boolean {
  if (context.listing.includes(path) || context.localFolders.has(path)) {
    return true;
  }
  // A listing is files, so a directory exists in it only because some path goes through it — and that
  // is true whichever kind the person is typing. A file named `src` where `src/main.ts` is listed is
  // taken too: the folder answers `exists` for it, so the row has to say so first.
  return context.listing.some((listed) => listed.startsWith(`${path}/`));
}

/** The directory on the way to a path that is a file in the listing, if there is one. */
function fileOnTheWay(path: string, listing: readonly string[]): string | undefined {
  const parent = parentOf(path);
  if (parent === '') {
    return undefined;
  }
  const segments = parent.split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    const prefix = segments.slice(0, index).join('/');
    if (listing.includes(prefix)) {
      return prefix;
    }
  }
  return undefined;
}

/**
 * The directories a path will make on its way to the entry, outermost first.
 *
 * "Not there" is asked of the listing and of what this session made: a directory the room knows is
 * one a listed path goes through, and one this session made is in `localFolders`. A name typed into
 * the wrong folder is a typo far more often than an intention, so the line says what the commit will
 * do rather than refusing it — the person reads `Also creates the folder docs/.` before pressing
 * anything.
 */
export function missingFolders(path: string, context: NewEntryContext): string[] {
  const parent = parentOf(path);
  if (parent === '') {
    return [];
  }
  const known = new Set<string>(context.localFolders);
  for (const listed of context.listing) {
    const segments = listed.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      known.add(segments.slice(0, index).join('/'));
    }
  }
  const missing: string[] = [];
  const segments = parent.split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    const prefix = segments.slice(0, index).join('/');
    if (!known.has(prefix)) {
      missing.push(prefix);
    }
  }
  return missing;
}
