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
  NEW_ENTRY_NEEDS_A_NAME,
  createInFolder,
  newEntryPath,
  newFolderCreatedSentence,
  wireNewEntry,
} from '../src/browser/new-entry.ts';

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

describe('the row that asks for the name', () => {
  it('creates a file from the typed name and clears the field', async () => {
    const surface = makeRow();
    const asked: Array<[string, string]> = [];
    const row = wireNewEntry({
      surface,
      create: async (path, entry) => {
        asked.push([path, entry]);
        return undefined;
      },
    });
    surface.name.value = ' notes.md ';
    surface.file.fire('click');
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(asked, [['notes.md', 'file']]);
    assert.equal(surface.name.value, '');
    assert.equal(surface.message.textContent, '');
    row.dispose();
  });

  it('creates a directory from the folder button, and says what the room learns', async () => {
    const surface = makeRow();
    const asked: Array<[string, string]> = [];
    const row = wireNewEntry({
      surface,
      create: async (path, entry) => {
        asked.push([path, entry]);
        return newFolderCreatedSentence(path);
      },
    });
    surface.name.value = 'docs';
    surface.folder.fire('click');
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(asked, [['docs', 'directory']]);
    assert.match(surface.message.textContent, /docs is in the folder/);
    row.dispose();
  });

  it("shows a refusal's own sentence and leaves the name typed", async () => {
    const surface = makeRow();
    const row = wireNewEntry({
      surface,
      create: async () => '.env is not a path this room shares, so it was not created.',
    });
    surface.name.value = '.env';
    surface.file.fire('click');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(
      surface.message.textContent,
      '.env is not a path this room shares, so it was not created.',
    );
    assert.equal(surface.name.value, '.env', 'the refused name was cleared instead of kept');
    row.dispose();
  });

  it('asks for a name rather than creating one when the field is empty', async () => {
    const surface = makeRow();
    let asked = 0;
    const row = wireNewEntry({
      surface,
      create: async () => {
        asked += 1;
        return undefined;
      },
    });
    surface.name.value = '   ';
    surface.file.fire('click');
    await Promise.resolve();
    assert.equal(asked, 0);
    assert.equal(surface.message.textContent, NEW_ENTRY_NEEDS_A_NAME);
    row.dispose();
  });

  it('runs the file action on Enter in the field, and steals the key from the form', () => {
    const surface = makeRow();
    const asked: Array<[string, string]> = [];
    const row = wireNewEntry({
      surface,
      create: async (path, entry) => {
        asked.push([path, entry]);
        return undefined;
      },
    });
    let prevented = 0;
    surface.name.value = 'notes.md';
    surface.name.fire('keydown', {
      key: 'Enter',
      preventDefault: () => void (prevented += 1),
    });
    assert.equal(prevented, 1);
    assert.deepEqual(asked, [['notes.md', 'file']]);
    row.dispose();
  });

  it('is hidden and emptied when the session it belonged to ends', () => {
    const surface = makeRow();
    const row = wireNewEntry({ surface, create: async () => undefined });
    row.show(true);
    assert.equal(surface.row.hidden, false);
    surface.name.value = 'half-typed';
    surface.message.textContent = 'a sentence';
    row.reset();
    row.show(false);
    assert.equal(surface.row.hidden, true);
    assert.equal(surface.name.value, '');
    assert.equal(surface.message.textContent, '');
    row.dispose();
  });
});

describe('the page the row is wired into', () => {
  // `main.ts` is the bundle's entry and reads the document as it loads, so what it wires is pinned
  // by its own text, the way the page's other chrome is: the row is in the shell, it is shown to
  // the window that holds a folder, and the act it drives is `createInFolder` with the page's own
  // folder, listing and opener.
  it('is in the shell, hidden, with every part the row wires', () => {
    assert.match(SHELL, /id="new-entry" hidden/);
    for (const id of ['new-entry', 'new-name', 'new-file', 'new-folder', 'new-message']) {
      assert.ok(SHELL.includes(`id="${id}"`), `${id} is not in the shell`);
    }
    assert.match(MAIN, /wireNewEntry\(\{/);
    for (const part of ['newEntryRow', 'newFileButton', 'newFolderButton', 'newFileName', 'newEntryMessage']) {
      assert.ok(MAIN.includes(part), `${part} is not read from the shell`);
    }
  });

  it('is offered to the host that holds the folder, and taken down with the session', () => {
    assert.match(MAIN, /newEntry\.show\(seat\.folder !== undefined\)/);
    assert.match(MAIN, /canCreate: \(\) => hostFolder !== undefined/);
    assert.match(MAIN, /newEntry\.show\(false\)/);
    assert.match(MAIN, /newEntry\.reset\(\)/);
    assert.match(MAIN, /hostFolder = undefined/);
  });

  it('makes the entry in the order the room learns it in', () => {
    assert.match(
      MAIN,
      /createInFolder\(\{ folder, publish: republishGrant, open: openPath \}, path, entry\)/,
    );
    // The listing source the room was sealed from moves before the room is told, so a state sealed
    // from it later cannot carry a listing the folder no longer has.
    const replaced = MAIN.indexOf('listing.replace(paths)');
    const granted = MAIN.indexOf('await engine.grant(paths)');
    assert.ok(replaced > 0 && granted > 0, 'nothing republishes the listing');
    assert.ok(replaced < granted, 'the room was told before the source the state is sealed from');
  });
});
