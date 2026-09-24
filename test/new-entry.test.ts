/**
 * The create a browser host makes from the page: the row that asks for the name, the order the
 * page runs it in, and what the room learns from it.
 *
 * The folder is a double (the page's own suite is `node --test` with no DOM), but the pieces
 * between the row and the room are the real ones: `FolderWorkingCopy` decides what may be created,
 * `listingSource` is what a state is sealed from, and the guest's half is the tree this page draws
 * a listing with. What is asserted is the path a person takes — a name typed, a file made, a
 * listing published, a file opened — and the sentence a refusal puts under the field.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { FolderWorkingCopy } from '../src/browser/folder.ts';
import type { FolderDirectoryHandle, FolderEntry, FolderFileHandle } from '../src/browser/folder.ts';
import { listingSource } from '../src/browser/relay.ts';
import { grantLevels } from '../src/browser/tree.ts';
import { grantUnion } from '../src/bridge/index.ts';
import {
  checkNewEntry,
  createInFolder,
  missingFolders,
  newEntryHint,
  newEntryPath,
} from '../src/browser/new-entry.ts';
import type { NewEntryContext } from '../src/browser/new-entry.ts';

const MAIN = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

// -- a folder, in memory -----------------------------------------------------

interface FileNode {
  kind: 'file';
  text: string;
  lastModified: number;
}

interface DirNode {
  kind: 'directory';
  children: Record<string, TreeNode>;
}

type TreeNode = FileNode | DirNode;

let stamp = 10;

function dirOf(children: Record<string, TreeNode> = {}): DirNode {
  return { kind: 'directory', children };
}

function fileHandleOf(name: string, node: FileNode): FolderFileHandle {
  return {
    kind: 'file',
    name,
    async getFile() {
      return {
        lastModified: node.lastModified,
        size: new TextEncoder().encode(node.text).length,
        arrayBuffer: async () => new TextEncoder().encode(node.text).buffer,
      };
    },
    async createWritable() {
      let pending = '';
      return {
        async write(data: string) {
          pending += data;
        },
        async close() {
          node.text = pending;
          node.lastModified += 1;
        },
      };
    },
  };
}

function dirHandleOf(name: string, node: DirNode): FolderDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values(): AsyncIterableIterator<FolderEntry> {
      for (const [childName, child] of Object.entries(node.children)) {
        yield { name: childName, kind: child.kind };
      }
    },
    async getDirectoryHandle(childName: string, options?: { create?: boolean }) {
      let child = node.children[childName];
      if (child === undefined) {
        if (options?.create !== true) {
          throw new DOMException('NotFoundError from the double', 'NotFoundError');
        }
        child = dirOf();
        node.children[childName] = child;
      }
      if (child.kind !== 'directory') {
        throw new DOMException('TypeMismatchError from the double', 'TypeMismatchError');
      }
      return dirHandleOf(childName, child);
    },
    async getFileHandle(childName: string, options?: { create?: boolean }) {
      let child = node.children[childName];
      if (child === undefined) {
        if (options?.create !== true) {
          throw new DOMException('NotFoundError from the double', 'NotFoundError');
        }
        stamp += 1;
        child = { kind: 'file', text: '', lastModified: stamp };
        node.children[childName] = child;
      }
      if (child.kind !== 'file') {
        throw new DOMException('TypeMismatchError from the double', 'TypeMismatchError');
      }
      return fileHandleOf(childName, child);
    },
  };
}

/** The page's own pieces around one create: the folder, the listing source, and the room. */
function page(tree: DirNode) {
  const folder = new FolderWorkingCopy(dirHandleOf('project', tree));
  const listing = listingSource();
  const published: string[][] = [];
  const opened: string[] = [];
  const room = {
    grant: (paths: readonly string[]) => paths,
  };
  return {
    folder,
    tree,
    listing,
    published,
    opened,
    create: (path: string, entry: 'file' | 'directory') =>
      createInFolder(
        {
          folder,
          publish: async (paths) => {
            listing.replace(paths);
            published.push([...paths]);
            room.grant(paths);
          },
          open: async (path) => void opened.push(path),
        },
        path,
        entry,
      ),
  };
}

/** What a guest's tree shows, from the listing the room was given and the paths it holds open. */
function guestTree(grant: readonly string[], documents: readonly string[] = []) {
  const levels = grantLevels(grantUnion(grant, documents));
  return (levels.get('') ?? []).map((child) => `${child.name}${child.directory ? '/' : ''}`);
}

// -- the rows -----------------------------------------------------------------

/** A DOM the row can be driven through: elements that remember their listeners and their text. */
function makeElement(tag: string) {
  const element = {
    tag,
    children: [] as unknown[],
    textContent: '',
    value: '',
    disabled: false,
    hidden: false,
    handlers: {} as Record<string, Array<(event: unknown) => void>>,
    addEventListener: (type: string, run: (event: unknown) => void) => {
      (element.handlers[type] ??= []).push(run);
    },
    removeEventListener: (type: string, run: (event: unknown) => void) => {
      element.handlers[type] = (element.handlers[type] ?? []).filter((known) => known !== run);
    },
    fire: (type: string, event: unknown = {}) => {
      for (const run of element.handlers[type] ?? []) {
        run(event);
      }
    },
  };
  return element;
}

function makeRow() {
  const surface = {
    row: makeElement('div'),
    file: makeElement('button'),
    folder: makeElement('button'),
    name: makeElement('input'),
    message: makeElement('p'),
  };
  return surface;
}

describe('the name a create is asked for', () => {
  it('is the typed name, trimmed, with the slashes a folder habit adds dropped', () => {
    assert.equal(newEntryPath('  notes.md  '), 'notes.md');
    assert.equal(newEntryPath('docs/'), 'docs');
    assert.equal(newEntryPath('docs///'), 'docs');
    assert.equal(newEntryPath('src/notes.md'), 'src/notes.md');
    // Nothing is stripped but the trailing slashes: what may not be shared is the layer's rule,
    // and it says so in its own sentence rather than being guessed at here.
    assert.equal(newEntryPath('../outside.md'), '../outside.md');
    assert.equal(newEntryPath('/etc/passwd'), '/etc/passwd');
  });

  it('is nothing at all for an empty field', () => {
    assert.equal(newEntryPath(''), undefined);
    assert.equal(newEntryPath('   '), undefined);
    assert.equal(newEntryPath('///'), undefined);
  });
});

describe('the create, from the page to the room', () => {
  it('makes the file, publishes the walk, and opens it', async () => {
    const tree = dirOf({ 'README.md': { kind: 'file', text: 'r\n', lastModified: 1 } });
    const app = page(tree);
    await app.folder.list();

    const outcome = await app.create('notes.md', 'file');
    assert.equal(outcome.kind, 'created');
    // The listing the room is told is the walk's own answer, which now holds the new path.
    assert.deepEqual(app.published, [['README.md', 'notes.md']]);
    assert.deepEqual(app.listing.current(), ['README.md', 'notes.md']);
    // The open is what makes a file's text reach the room at all.
    assert.deepEqual(app.opened, ['notes.md']);
  });

  it("is a file a guest's tree shows, from the listing the room was given", async () => {
    const app = page(dirOf());
    await app.folder.list();
    await app.create('notes.md', 'file');
    assert.deepEqual(guestTree(app.published.at(-1) ?? []), ['notes.md']);
  });

  it('publishes nothing and opens nothing for a refused name', async () => {
    const app = page(dirOf({ '.env': { kind: 'file', text: 'S=1', lastModified: 1 } }));
    await app.folder.list();
    const outcome = await app.create('.env', 'file');
    assert.equal(outcome.kind === 'refused' ? outcome.cause : '', 'not-granted');
    assert.deepEqual(app.published, []);
    assert.deepEqual(app.opened, []);
  });

  it('publishes the folder again for a directory, and opens nothing', async () => {
    // A directory is not in a listing (a room's listing is files), so what the room learns is
    // the folder as it stands; the row's own sentence says when the directory shows up.
    const tree = dirOf();
    const app = page(tree);
    const made = await app.create('docs', 'directory');
    assert.equal(made.kind, 'created');
    assert.deepEqual(app.published, [[]]);
    assert.deepEqual(app.opened, []);
    assert.equal((tree.children['docs'] as DirNode).kind, 'directory');
    // The name is taken now, so the other kind is refused rather than made over it.
    const again = await app.create('docs', 'file');
    assert.equal(again.kind === 'refused' ? again.cause : '', 'exists');
    assert.deepEqual(app.published, [[]]);
  });

  it('publishes a file made inside a directory the folder holds, as a path in the tree', async () => {
    const app = page(dirOf({ src: dirOf() }));
    await app.folder.list();
    await app.create('src/notes.md', 'file');
    assert.deepEqual(app.published, [['src/notes.md']]);
    assert.deepEqual(guestTree(app.published.at(-1) ?? []), ['src/']);
  });

  it('says a create that reached the folder and not the room as exactly that', async () => {
    // The entry is on disk from the moment `create` answers, so a failure after it is not a create
    // that did not happen: a row that said "was not created" would be telling a person their file
    // is missing while it sits in their folder, and a retry of the same name would answer `exists`.
    const app = page(dirOf());
    const outcome = await createInFolder(
      {
        folder: app.folder,
        publish: async () => {
          throw new Error('the relay closed');
        },
        open: async (path) => void app.opened.push(path),
      },
      'notes.md',
      'file',
    );
    assert.equal(outcome.kind, 'incomplete');
    assert.match(
      outcome.kind === 'incomplete' ? outcome.sentence : '',
      /notes\.md is in the folder, but the room was not told the listing changed: the relay closed/,
    );
    // It is there, which is what the sentence had to say; the open is past the failure and did not run.
    assert.equal((app.tree.children['notes.md'] as FileNode | undefined)?.kind, 'file');
    assert.deepEqual(app.opened, []);
  });

  it('says a created file that could not be opened as exactly that', async () => {
    const app = page(dirOf());
    const outcome = await createInFolder(
      {
        folder: app.folder,
        publish: async (paths) => void app.published.push([...paths]),
        open: async () => {
          throw new Error('the editor is gone');
        },
      },
      'notes.md',
      'file',
    );
    assert.equal(outcome.kind, 'incomplete');
    assert.match(
      outcome.kind === 'incomplete' ? outcome.sentence : '',
      /the room lists it, but this page could not open it: the editor is gone/,
    );
    // The listing did go out, which is what the sentence says: the room has the path, not the text.
    assert.deepEqual(app.published, [['notes.md']]);
  });

  it("keeps a listed path open in the guest's tree before the walk publishes it", async () => {
    // The room offers the grant unioned with the documents it holds (`grantUnion`), which is why
    // the open is worth taking: the path is in the room the moment its text is.
    assert.deepEqual(guestTree([], ['notes.md']), ['notes.md']);
  });
});


// -- the rules the create row applies as a person types ------------------------

/** A context with sensible defaults, so each test states only what it is about. */
function context(overrides: Partial<NewEntryContext> = {}): NewEntryContext {
  return {
    kind: 'file',
    raw: '',
    parent: '',
    room: 'demo-app',
    listing: [],
    localFolders: new Set<string>(),
    ...overrides,
  };
}

describe('the line under the field', () => {
  it('says what Enter does and where the entry will land, at the root and in a directory', () => {
    assert.equal(
      newEntryHint('file', '', 'demo-app'),
      'Enter creates the file in demo-app · Esc cancels',
    );
    assert.equal(
      newEntryHint('file', 'src', 'demo-app'),
      'Enter creates the file in src/ · Esc cancels',
    );
    assert.equal(
      newEntryHint('directory', 'src', 'demo-app'),
      'Enter creates the folder in src/ · Esc cancels',
    );
  });

  it('is the instruction while the field is empty, and is not an error', () => {
    const check = checkNewEntry(context());
    assert.equal(check.line, 'Enter creates the file in demo-app · Esc cancels');
    assert.equal(check.error, false);
    assert.equal(check.path, undefined, 'an empty field would create something');
  });
});

describe('the live checks', () => {
  it('refuses a name the room cannot share, in the grant rule’s own words', () => {
    // The same rule the folder applies on commit (`isGrantedPath`), called rather than copied: a
    // name the row takes is a name the folder takes.
    for (const name of ['.env', 'a/../b', '/abs', 'src/.git/config']) {
      const check = checkNewEntry(context({ raw: name }));
      assert.equal(check.error, true, `${name} was accepted`);
      assert.match(check.line, /is not a path this room shares\./, `wrong refusal for ${name}: ${check.line}`);
      assert.equal(check.path, undefined);
    }
  });

  it('refuses a format a room cannot carry, and names the alternative', () => {
    const check = checkNewEntry(context({ raw: 'logo.png' }));
    assert.equal(check.error, true);
    assert.equal(check.line, 'logo.png declares a format a room cannot carry. Name a text file.');
    // A directory named after a format is governed by the directory excludes alone: the binary
    // rule is about files, which is the rule the folder itself applies.
    assert.equal(checkNewEntry(context({ raw: 'assets.png', kind: 'directory' })).error, false);
  });

  it('refuses a name that is already in the folder, file or directory', () => {
    const listing = ['README.md', 'src/main.ts'];
    assert.equal(
      checkNewEntry(context({ raw: 'README.md', listing })).line,
      'README.md is already in the folder. Pick another name.',
    );
    // A directory is taken by any listed path that goes through it, which is the only way a listing
    // of files can say a directory exists.
    assert.equal(
      checkNewEntry(context({ raw: 'src', kind: 'directory', listing })).line,
      'src is already in the folder. Pick another name.',
    );
    // And by one this session made, which no listing carries.
    assert.equal(
      checkNewEntry(
        context({ raw: 'docs', kind: 'directory', localFolders: new Set(['docs']) }),
      ).line,
      'docs is already in the folder. Pick another name.',
    );
  });

  it('refuses a path that goes through a file', () => {
    const check = checkNewEntry(context({ raw: 'main.rs/x', listing: ['main.rs'] }));
    assert.equal(check.error, true);
    assert.equal(check.line, 'main.rs is a file, not a folder.');
  });

  it('previews the directories a path will make, without calling it an error', () => {
    const check = checkNewEntry(context({ raw: 'docs/intro.md' }));
    assert.equal(check.error, false, 'making a directory was refused rather than previewed');
    assert.equal(check.line, 'Also creates the folder docs/.');
    assert.equal(check.path, 'docs/intro.md', 'the preview took the path away');
    // Deeper paths say every folder they will make, outermost first.
    assert.deepEqual(missingFolders('docs/api/intro.md', context()), ['docs', 'docs/api']);
    assert.equal(
      checkNewEntry(context({ raw: 'docs/api/intro.md' })).line,
      'Also creates the folders docs/ and docs/api/.',
    );
    // A directory the listing already implies is not one of them.
    assert.deepEqual(missingFolders('src/app/intro.md', context({ listing: ['src/main.ts'] })), [
      'src/app',
    ]);
    // Nor is one this session made.
    assert.deepEqual(
      missingFolders('docs/intro.md', context({ localFolders: new Set(['docs']) })),
      [],
    );
  });

  it('is the instruction again as soon as the name is one the room can take', () => {
    const check = checkNewEntry(context({ raw: 'notes.md', listing: ['README.md'] }));
    assert.equal(check.error, false);
    assert.equal(check.line, 'Enter creates the file in demo-app · Esc cancels');
    assert.equal(check.path, 'notes.md');
  });

  it('trims, and reads a typed name inside a directory as a path below it', () => {
    assert.equal(newEntryPath('  notes.md  '), 'notes.md');
    assert.equal(newEntryPath('docs/'), 'docs');
    const check = checkNewEntry(context({ raw: ' notes.md ', parent: 'src', listing: ['src/main.ts'] }));
    assert.equal(check.path, 'src/notes.md');
    assert.equal(checkNewEntry(context({ raw: 'main.ts', parent: 'src', listing: ['src/main.ts'] })).error, true);
  });
});

describe('the create the page runs for the row', () => {
  it('marks a create that landed but was not finished, rather than reporting it as missing', async () => {
    // The row closes on this one, and the path wears the sentence: the entry *is* in the folder, so
    // a field left open saying it was not created would be telling the person their file is gone.
    const app = page(dirOf());
    const outcome = await createInFolder(
      {
        folder: app.folder,
        publish: async (paths) => void app.published.push([...paths]),
        open: async (path) => void app.opened.push(path),
      },
      'docs/intro.md',
      'file',
    );
    assert.equal(outcome.kind, 'created');
    assert.equal((app.tree.children['docs'] as DirNode | undefined)?.kind, 'directory');
    assert.equal(((app.tree.children['docs'] as DirNode).children['intro.md'] as FileNode).kind, 'file');
    assert.deepEqual(app.published, [['docs/intro.md']]);
    assert.deepEqual(app.opened, ['docs/intro.md']);
  });

  it('refuses a directory through a file the folder holds, at the folder’s own word', async () => {
    const app = page(dirOf({ 'main.rs': { kind: 'file', text: 'fn main() {}', lastModified: 1 } }));
    const outcome = await createInFolder(
      { folder: app.folder, publish: async () => {}, open: async () => {} },
      'main.rs/x',
      'file',
    );
    assert.equal(outcome.kind === 'refused' ? outcome.cause : '', 'not-a-file');
  });
});

describe('the page the row is drawn in', () => {
  it('carries both create verbs, always visible, for the window that holds a folder', () => {
    for (const id of ['shared-actions', 'new-file', 'new-folder']) {
      assert.ok(SHELL.includes(`id="${id}"`), `${id} is not in the shell`);
    }
    assert.ok(!SHELL.includes('id="new-entry"'), 'the old standing field is still in the shell');
    assert.ok(!SHELL.includes('id="new-message"'), 'the old refusal line is still in the shell');
    assert.ok(!SHELL.includes('placeholder="notes.md"'), 'the greyed example is still in the shell');
    assert.match(MAIN, /newFileButton\.addEventListener\('click'/, 'the new-file verb does nothing');
    assert.match(MAIN, /newFolderButton\.addEventListener\('click'/, 'the new-folder verb does nothing');
    assert.match(MAIN, /sharedActions\.hidden = seat\.folder === undefined/, 'a guest is offered a create');
  });

  it('opens the editable row in the tree, where the entry will appear', () => {
    const view = readFileSync(new URL('../src/browser/tree-view.ts', import.meta.url), 'utf8');
    assert.match(view, /beginCreate\(kind: NewEntryKind, parent: string\)/, 'the tree opens no create row');
    assert.match(view, /placeDraft\(\)/, 'the row is drawn nowhere in the tree');
    assert.match(view, /classList\.toggle\('invalid', check\.error\)/, 'a refusal is not shown on the field');
    assert.match(view, /checkNewEntry\(context\)/, 'the row applies rules of its own');
  });

  it('makes the entry in the order the room learns it in', () => {
    assert.match(
      MAIN,
      /createInFolder\(\{ folder, publish: republishGrant, open: openPath \}, path, entry\)/,
      'the create runs in another order',
    );
    // The listing source the room was sealed from moves before the room is told, so a state sealed
    // from it later cannot carry a listing the folder no longer has.
    const replaced = MAIN.indexOf('listing.replace(paths)');
    const granted = MAIN.indexOf('await engine.grant(paths)');
    assert.ok(replaced > 0 && granted > 0, 'nothing republishes the listing');
    assert.ok(replaced < granted, 'the room was told before the source the state is sealed from');
  });

  it('remembers the empty folders it made, as this session’s own rows', () => {
    // A room's listing is files, so an empty directory is in none: without this, the folder a host
    // just made would vanish from the tree and the next create into it would be refused.
    assert.match(MAIN, /madeFolders\.add\(path\)/, 'a made directory is not remembered');
    assert.match(MAIN, /localFolders: \(\) => madeFolders/, 'the tree is told about no local folders');
    assert.match(MAIN, /madeFolders\.clear\(\)/, 'a session’s folders outlive it');
  });
});
