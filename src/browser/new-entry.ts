/**
 * The control a browser host creates a file or a directory in its picked folder with.
 *
 * A room's shape is what its host's folder holds, so a fresh room whose folder is empty is a dead
 * end: nothing can be opened, the editor stands read-only in front of nobody, and the tree says the
 * host has shared nothing. The way out is a create, which is a host-side act the folder walk then
 * publishes — so this is the row that asks for the name, and it is offered only to the window that
 * holds the folder.
 *
 * The kind comes from the button rather than from the name, because a name cannot say whether
 * `docs` is a file or a directory and a convention that reads a trailing slash as one is a rule the
 * person has to know. The field and its two actions stand together, Enter in the field is the
 * first action (a file, which is what most creates are), and nothing here decides what a name may
 * be: `folder.ts` applies the shared rules and this row shows the sentence it refuses with.
 */

import type { FolderCreate, NewEntryKind } from './folder.ts';

/** The row, the name field, its two actions, and the line one of them is answered on. */
export interface NewEntrySurface {
  /** The row itself, hidden until the window holding the folder is the one being shown it. */
  row: HTMLElement;
  /** Creates a file from the typed name. */
  file: HTMLButtonElement;
  /** Creates a directory at the typed name. */
  folder: HTMLButtonElement;
  /** The name, or a path inside a directory the tree already shows. */
  name: HTMLInputElement;
  /**
   * The line under the field: the refusal's own sentence, or what a created directory's effect on
   * the room is. A created file needs none — it opens, which is the answer.
   */
  message: HTMLElement;
}

export interface NewEntryOptions {
  surface: NewEntrySurface;
  /**
   * Makes the entry, publishing the room's listing on the way. Answers with the sentence the row
   * shows, or `undefined` when the outcome is its own answer (a file that just opened).
   */
  create: (path: string, entry: NewEntryKind) => Promise<string | undefined>;
}

export interface NewEntry {
  /** Shows or hides the row: only the window that holds the folder has anything to create in. */
  show(shown: boolean): void;
  /** Empties the field and the line. */
  reset(): void;
  dispose(): void;
}

/** What a create needs of the folder it makes something in. */
export interface HostFolder {
  create(path: string, entry: NewEntryKind): Promise<FolderCreate>;
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
 * opened reads empty to every guest, which is the page's own unpublished pill. A directory is not:
 * there is nothing to open, and the room learns it when the first file inside it appears.
 *
 * The two refusals are the folder's own sentence, returned untouched so the row says what the
 * layer said; a failure thrown by `create` is the layer's own and is left to the caller to word.
 * The steps after it are this act's, and each is reported as itself (`CreateOutcome`).
 */
export async function createInFolder(
  options: CreateInFolder,
  path: string,
  entry: NewEntryKind,
): Promise<CreateOutcome> {
  const outcome = await options.folder.create(path, entry);
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

/** What an empty name is answered with, under the field it is about. */
export const NEW_ENTRY_NEEDS_A_NAME = 'Name the new file or folder first.';

/**
 * The path a typed name asks for, or `undefined` when it names nothing.
 *
 * Trimmed, and trailing slashes dropped: the button that was pressed is what says which kind this
 * is, so a slash a person writes out of habit is noise rather than information. Everything else is
 * left exactly as typed, and the folder layer's own rule refuses what may not be shared — an
 * absolute path, a `..`, an excluded name — with the sentence that says so.
 */
export function newEntryPath(raw: string): string | undefined {
  const path = raw.trim().replace(/\/+$/, '');
  return path === '' ? undefined : path;
}

/**
 * What the row says when a directory was created.
 *
 * A room's listing is files (`PROTOCOL.md` §5), so a directory joins the tree when the first file
 * inside it does, and a create that said only "done" would leave a person looking at nothing. A
 * file needs no such line: creating one opens it, and the open is what puts it in the room.
 */
export function newFolderCreatedSentence(path: string): string {
  return `${path} is in the folder. A room's listing is files, so it appears in Shared once a file is inside it.`;
}

/** Wires the name field and its two actions; the caller decides when they are shown. */
export function wireNewEntry(options: NewEntryOptions): NewEntry {
  const { row, file, folder, name, message } = options.surface;
  let busy = false;

  const run = async (entry: NewEntryKind): Promise<void> => {
    if (busy) {
      return;
    }
    const path = newEntryPath(name.value);
    if (path === undefined) {
      message.textContent = NEW_ENTRY_NEEDS_A_NAME;
      return;
    }
    busy = true;
    file.disabled = true;
    folder.disabled = true;
    try {
      const sentence = await options.create(path, entry);
      if (sentence === undefined) {
        name.value = '';
        message.textContent = '';
        return;
      }
      message.textContent = sentence;
    } finally {
      busy = false;
      file.disabled = false;
      folder.disabled = false;
    }
  };

  const onFile = (): void => {
    void run('file');
  };
  const onFolder = (): void => {
    void run('directory');
  };
  // The field's Enter runs the leading action, which is the file button: a create typed as a bare
  // name is a file far more often than a directory, and the directory's own button is beside it.
  const onEnter = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    void run('file');
  };

  file.addEventListener('click', onFile);
  folder.addEventListener('click', onFolder);
  name.addEventListener('keydown', onEnter);

  return {
    show(shown: boolean): void {
      row.hidden = !shown;
    },
    reset(): void {
      name.value = '';
      message.textContent = '';
    },
    dispose(): void {
      file.removeEventListener('click', onFile);
      folder.removeEventListener('click', onFolder);
      name.removeEventListener('keydown', onEnter);
    },
  };
}
