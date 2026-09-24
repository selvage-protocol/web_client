/**
 * The picked folder as a working copy: the listing, the read, and the write behind the
 * stale-file guard.
 *
 * The doubles here are the two things the module is written against structurally — a directory
 * handle and a file handle — so the whole module runs without a browser. Where the double has to
 * imitate Chromium rather than an ideal filesystem, the test says so and names what was observed
 * (`BROWSER_NOTES.md`, the symbolic-link probe).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_GRANT_FILE_BYTES } from '../src/bridge/index.ts';
import {
  FOLDER_PICKER_OPTIONS,
  FolderWorkingCopy,
  decodableText,
  folderCreateSentence,
  folderPickerOf,
  folderWriteSentence,
  pickFolder,
} from '../src/browser/folder.ts';
import type {
  FolderDirectoryHandle,
  FolderEntry,
  FolderFileHandle,
  FolderWritable,
} from '../src/browser/folder.ts';

interface FileNode {
  kind: 'file';
  text: string;
  /** The stamp the guard compares; a writer bumps it, as a real filesystem does. */
  lastModified: number;
  /** A size to report instead of the text's, so a bound can be driven without bytes. */
  size?: number;
  /** Set when the leaf must behave as something other than a plain readable file. */
  fails?: string;
}

interface DirNode {
  kind: 'directory';
  children: Record<string, TreeNode>;
}

type TreeNode = FileNode | DirNode;

function file(text: string, lastModified = 1): FileNode {
  return { kind: 'file', text, lastModified };
}

/**
 * The stamp a created file is given. Chromium gives a fresh `lastModified` to a file it makes, and
 * a double that reused one would hide the difference between a file this page made and one it
 * never saw.
 */
let createdStamps = 100;

function dir(children: Record<string, TreeNode>): DirNode {
  return { kind: 'directory', children };
}

/** Every write this double was asked to perform, so a refusal can be shown to write nothing. */
interface Log {
  writes: string[];
  aborted: number;
}

function domError(name: string): Error {
  return new DOMException(`${name} from the double`, name);
}

function fileHandleOf(name: string, node: FileNode, log: Log): FolderFileHandle {
  return {
    kind: 'file',
    name,
    async getFile() {
      if (node.fails !== undefined) {
        throw domError(node.fails);
      }
      return {
        lastModified: node.lastModified,
        size: node.size ?? new TextEncoder().encode(node.text).length,
        arrayBuffer: async () => new TextEncoder().encode(node.text).buffer,
      };
    },
    async createWritable(): Promise<FolderWritable> {
      let pending = '';
      let closed = false;
      return {
        async write(data: string) {
          pending += data;
        },
        async close() {
          log.writes.push(`${name}:${pending}`);
          closed = true;
          node.text = pending;
          node.lastModified += 1;
        },
        async abort() {
          log.aborted += 1;
          void closed;
        },
      };
    },
  };
}

function dirHandleOf(name: string, node: DirNode, log: Log): FolderDirectoryHandle {
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
          throw domError('NotFoundError');
        }
        child = dir({});
        node.children[childName] = child;
      }
      if (child.kind !== 'directory') {
        // The real API tells the two apart: absent is `NotFoundError`, present-and-not-a-
        // directory is `TypeMismatchError`.
        throw domError('TypeMismatchError');
      }
      return dirHandleOf(childName, child, log);
    },
    async getFileHandle(childName: string, options?: { create?: boolean }) {
      let child = node.children[childName];
      if (child === undefined) {
        if (options?.create !== true) {
          throw domError('NotFoundError');
        }
        createdStamps += 1;
        child = file('', createdStamps);
        node.children[childName] = child;
      }
      if (child.kind !== 'file') {
        throw domError('TypeMismatchError');
      }
      return fileHandleOf(childName, child, log);
    },
  };
}

function projection(tree: DirNode): { folder: FolderWorkingCopy; tree: DirNode; log: Log } {
  const log: Log = { writes: [], aborted: 0 };
  return { folder: new FolderWorkingCopy(dirHandleOf('project', tree, log)), tree, log };
}

describe('the listing', () => {
  it('is files only, ascending, with the directories derived from it', async () => {
    const { folder } = projection(
      dir({
        'src': dir({ 'b.ts': file('b'), 'main.ts': file('a'), 'nested': dir({ 'deep.txt': file('d') }) }),
        'README.md': file('r'),
      }),
    );
    assert.deepEqual(await folder.list(), [
      'README.md',
      'src/b.ts',
      'src/main.ts',
      'src/nested/deep.txt',
    ]);
  });

  it('applies the shared excludes by name, however deep the name is', async () => {
    const { folder } = projection(
      dir({
        '.git': dir({ config: file('c') }),
        'node_modules': dir({ package: dir({ 'index.js': file('x') }) }),
        'src': dir({ '.env': file('S=1'), 'server.pem': file('k'), '.env.example': file('t') }),
        'keep.txt': file('k'),
      }),
    );
    assert.deepEqual(await folder.list(), ['keep.txt', 'src/.env.example']);
  });

  it('leaves out a name that declares a format a room cannot carry', async () => {
    const { folder } = projection(
      dir({ 'logo.png': file('binary-ish'), 'LICENSE.zip': file('x'), 'notes.txt': file('n') }),
    );
    assert.deepEqual(await folder.list(), ['notes.txt']);
  });

  it('leaves out a file over the bytes a session carries, and keeps the ones under', async () => {
    const big = file('x');
    big.size = MAX_GRANT_FILE_BYTES + 1;
    const exact = file('y');
    exact.size = MAX_GRANT_FILE_BYTES;
    const { folder } = projection(dir({ big, exact, 'small.txt': file('s') }));
    assert.deepEqual(await folder.list(), ['exact', 'small.txt']);
  });

  it('folds case, because a browser cannot tell whether the folder does', async () => {
    // The shared rule's answer for an unknown host. A case-sensitive checkout loses `Build/`
    // here; sharing less is the safer error, and the residual is stated in BROWSER_NOTES.md.
    const { folder } = projection(dir({ 'Build': dir({ 'out.txt': file('o') }), 'src': dir({ 'a.txt': file('a') }) }));
    assert.deepEqual(await folder.list(), ['src/a.txt']);
  });

  it('leaves a directory it cannot descend into out whole rather than failing the walk', async () => {
    // A grant is a listing and not a promise: a subtree that vanished between the listing and
    // the descent is left out, and the walk still publishes everything else it found.
    const log: Log = { writes: [], aborted: 0 };
    const top = file('t');
    const folder = new FolderWorkingCopy({
      kind: 'directory',
      name: 'project',
      async *values() {
        yield { name: 'src', kind: 'directory' as const };
        yield { name: 'top.txt', kind: 'file' as const };
      },
      async getDirectoryHandle() {
        throw domError('NotFoundError');
      },
      async getFileHandle() {
        return fileHandleOf('top.txt', top, log);
      },
    });
    assert.deepEqual(await folder.list(), ['top.txt']);
  });

  it('is empty for an empty folder, and names the folder it is', async () => {
    const { folder } = projection(dir({}));
    assert.deepEqual(await folder.list(), []);
    assert.equal(folder.name, 'project');
  });
});

describe('the read', () => {
  it('reads a nested file and remembers the stamp it saw', async () => {
    const { folder, tree } = projection(dir({ 'src': dir({ 'main.ts': file('let a = 1;\n') }) }));
    assert.deepEqual(await folder.read('src/main.ts'), { kind: 'text', text: 'let a = 1;\n' });
    const node = (tree.children.src as DirNode).children['main.ts'] as FileNode;
    assert.equal(folder.stampOf('src/main.ts'), node.lastModified);
  });

  it('refuses a name the grant would not publish, before it resolves anything', async () => {
    const { folder } = projection(dir({ '.env': file('SECRET=1') }));
    assert.deepEqual(await folder.read('.env'), { kind: 'refused', cause: 'not-granted' });
    assert.deepEqual(await folder.read('../outside.txt'), { kind: 'refused', cause: 'not-granted' });
    // Nothing was read, so nothing was stamped: a refused path is not a path this page saw.
    assert.equal(folder.stampOf('.env'), undefined);
  });

  it('once the folder is listed, serves the listing and nothing past it', async () => {
    const { folder } = projection(
      dir({
        'notes.txt': file('shared\n'),
        // Names the shared excludes let through, and a listing leaves out for its own reasons.
        '.env.production': file('SECRET=1'),
        'binary.png': file('not really a png'),
      }),
    );
    const listing = await folder.list();
    assert.ok(listing.includes('notes.txt'));
    assert.ok(!listing.includes('binary.png'));
    assert.deepEqual(await folder.read('notes.txt'), { kind: 'text', text: 'shared\n' });
    assert.deepEqual(await folder.read('binary.png'), { kind: 'refused', cause: 'not-granted' });
    assert.deepEqual(await folder.read('never-listed.txt'), { kind: 'refused', cause: 'not-granted' });
    assert.equal(folder.stampOf('binary.png'), undefined);
  });

  it('holds a peer to the latest listing, not the first one', async () => {
    const tree = dir({ 'a.txt': file('a\n') });
    const { folder } = projection(tree);
    await folder.list();
    tree.children['b.txt'] = file('b\n');
    assert.deepEqual(await folder.read('b.txt'), { kind: 'refused', cause: 'not-granted' });
    await folder.list();
    assert.deepEqual(await folder.read('b.txt'), { kind: 'text', text: 'b\n' });
  });

  it('names what is wrong with the path: missing, not a file, too large, binary', async () => {
    const huge = file('x');
    huge.size = MAX_GRANT_FILE_BYTES + 1;
    const { folder } = projection(
      dir({
        'src': dir({ 'a.txt': file('a') }),
        huge,
        'binary.dat': file('a\u0000b'),
        'broken.txt': { kind: 'file', text: '', lastModified: 1, fails: 'NotFoundError' },
      }),
    );
    assert.deepEqual(await folder.read('nope.txt'), { kind: 'refused', cause: 'missing' });
    assert.deepEqual(await folder.read('src/nope.txt'), { kind: 'refused', cause: 'missing' });
    assert.deepEqual(await folder.read('src'), { kind: 'refused', cause: 'not-a-file' });
    assert.deepEqual(await folder.read('src/a.txt/leaf'), { kind: 'refused', cause: 'not-a-file' });
    assert.deepEqual(await folder.read('huge'), { kind: 'refused', cause: 'too-large' });
    assert.deepEqual(await folder.read('binary.dat'), { kind: 'refused', cause: 'binary' });
    assert.deepEqual(await folder.read('broken.txt'), { kind: 'refused', cause: 'missing' });
  });

  it('leaves a failure it cannot name to the caller rather than guessing at one', async () => {
    // A guess at what an unknown failure meant is a sentence that sends a person looking in
    // the wrong place, and the bridge already has words for one it was handed.
    const { folder } = projection(
      dir({ 'odd.txt': { kind: 'file', text: '', lastModified: 1, fails: 'QuotaExceededError' } }),
    );
    await assert.rejects(() => folder.read('odd.txt'), /QuotaExceededError/);
  });

  it('is what a symbolic link gets: not found, as Chromium answers', async () => {
    // Observed on Chromium 152 with a real folder handle: a link is listed by nothing and
    // answers `NotFoundError` when asked for by name, in the folder or out of it. The page
    // cannot tell it got a link, because it never gets one (BROWSER_NOTES.md).
    const { folder } = projection(dir({ 'escape': { kind: 'file', text: '', lastModified: 1, fails: 'NotFoundError' } }));
    assert.deepEqual(await folder.read('escape'), { kind: 'refused', cause: 'missing' });
  });
});

describe('the write, behind the stale-file guard', () => {
  it('writes the room\'s text when the file is the one that was read', async () => {
    const { folder, tree, log } = projection(dir({ 'notes.txt': file('old\n', 7) }));
    await folder.read('notes.txt');
    assert.deepEqual(await folder.write('notes.txt', 'new\n'), { kind: 'written' });
    assert.equal((tree.children['notes.txt'] as FileNode).text, 'new\n');
    assert.deepEqual(log.writes, ['notes.txt:new\n']);
    // The stamp to compare against next time is the one the write left behind.
    assert.equal(folder.stampOf('notes.txt'), (tree.children['notes.txt'] as FileNode).lastModified);
    assert.equal(log.aborted, 0);
  });

  it('refuses a write when the file changed on disk since the room read it', async () => {
    const { folder, tree, log } = projection(dir({ 'notes.txt': file('read by the room\n', 7) }));
    await folder.read('notes.txt');
    // Something else wrote the file: a formatter, a build, a checkout, another editor.
    const node = tree.children['notes.txt'] as FileNode;
    node.text = 'written by someone else\n';
    node.lastModified = 9;

    const outcome = await folder.write('notes.txt', 'the room settled on this\n');
    assert.equal(outcome.kind, 'refused');
    assert.equal(outcome.kind === 'refused' ? outcome.cause : '', 'stale');
    assert.equal(node.text, 'written by someone else\n', 'the guard clobbered the file it refused');
    assert.deepEqual(log.writes, [], 'the guard opened a writable before deciding');
  });

  it('refuses a write for a path this page never read', async () => {
    const { folder, tree, log } = projection(dir({ 'notes.txt': file('never looked at\n', 3) }));
    const outcome = await folder.write('notes.txt', 'from the room\n');
    assert.equal(outcome.kind === 'refused' ? outcome.cause : '', 'unread');
    assert.equal((tree.children['notes.txt'] as FileNode).text, 'never looked at\n');
    assert.deepEqual(log.writes, []);
  });

  it('refuses a path the grant excludes, and one that is gone, and one that is not a file', async () => {
    const { folder, tree, log } = projection(dir({ '.env': file('S=1'), 'src': dir({ 'a.txt': file('a') }) }));
    assert.equal(refusalCause(await folder.write('.env', 'x')), 'not-granted');
    assert.equal(refusalCause(await folder.write('gone.txt', 'x')), 'unread');
    // Read, then deleted underneath the page: the guard finds nothing to compare against.
    await folder.read('src/a.txt');
    delete (tree.children['src'] as DirNode).children['a.txt'];
    assert.equal(refusalCause(await folder.write('src/a.txt', 'x')), 'missing');
    assert.deepEqual(log.writes, []);
  });

  it('leaves an unnamed write failure to the bridge rather than calling it a missing file', async () => {
    const node = file('a\n', 4);
    const folder = new FolderWorkingCopy({
      kind: 'directory',
      name: 'project',
      async *values() {
        yield { name: 'notes.txt', kind: 'file' as const };
      },
      async getDirectoryHandle() {
        throw domError('NotFoundError');
      },
      async getFileHandle() {
        return {
          kind: 'file',
          name: 'notes.txt',
          async getFile() {
            return {
              lastModified: node.lastModified,
              size: new TextEncoder().encode(node.text).length,
              arrayBuffer: async () => new TextEncoder().encode(node.text).buffer,
            };
          },
          async createWritable(): Promise<FolderWritable> {
            throw domError('QuotaExceededError');
          },
        };
      },
    });
    await folder.read('notes.txt');
    await assert.rejects(() => folder.write('notes.txt', 'x'), /QuotaExceededError/);
    assert.equal(node.text, 'a\n', 'a failed write left the file alone');
  });

  it('says the person lost write access rather than blaming the file', async () => {
    // A revoked permission is the one write failure a person can act on, and it reaches the
    // write as `NotAllowedError` from `createWritable` rather than as a missing file.
    const node = file('a\n', 4);
    const readOnly: FolderDirectoryHandle = {
      kind: 'directory',
      name: 'project',
      async *values() {
        yield { name: 'notes.txt', kind: 'file' as const };
      },
      async getDirectoryHandle() {
        throw domError('NotFoundError');
      },
      async getFileHandle() {
        return {
          kind: 'file',
          name: 'notes.txt',
          async getFile() {
            return {
              lastModified: node.lastModified,
              size: new TextEncoder().encode(node.text).length,
              arrayBuffer: async () => new TextEncoder().encode(node.text).buffer,
            };
          },
          async createWritable(): Promise<FolderWritable> {
            throw domError('NotAllowedError');
          },
        };
      },
    };
    const folder = new FolderWorkingCopy(readOnly);
    await folder.read('notes.txt');
    const outcome = await folder.write('notes.txt', 'x');
    assert.equal(refusalCause(outcome), 'not-permitted');
    assert.match(folderWriteSentence('not-permitted', 'notes.txt'), /write access/);
    assert.equal(node.text, 'a\n', 'a refused write left the file alone');
  });
});

describe('asking for the folder', () => {
  it('is unsupported when the browser has no picker at all', async () => {
    assert.equal(folderPickerOf({}), undefined);
    const outcome = await pickFolder(undefined);
    assert.equal(outcome.kind, 'refused');
    assert.equal(outcome.kind === 'refused' ? outcome.cause : '', 'unsupported');
    assert.match(
      outcome.kind === 'refused' ? outcome.sentence : '',
      /Firefox and Safari|Chromium/,
      'the unsupported sentence does not say which browsers can',
    );
  });

  it('is picked when a folder is chosen, with read and write asked for', async () => {
    const asked: unknown[] = [];
    const outcome = await pickFolder(async (options) => {
      asked.push(options);
      return dirHandleOf('project', dir({ 'a.txt': file('a') }), { writes: [], aborted: 0 });
    });
    assert.equal(outcome.kind, 'picked');
    assert.equal(outcome.kind === 'picked' ? outcome.folder.name : '', 'project');
    // Read *and* write: with read alone the room's settled text never reaches the folder.
    assert.deepEqual(asked, [FOLDER_PICKER_OPTIONS]);
    assert.equal(FOLDER_PICKER_OPTIONS.mode, 'readwrite');
    assert.equal(FOLDER_PICKER_OPTIONS.id, 'selvage');
  });

  it('tells a dismissed prompt apart from a refused one', async () => {
    const cancelled = await pickFolder(async () => {
      throw domError('AbortError');
    });
    assert.equal(cancelled.kind === 'refused' ? cancelled.cause : '', 'cancelled');
    const refused = await pickFolder(async () => {
      throw domError('SecurityError');
    });
    assert.equal(refused.kind === 'refused' ? refused.cause : '', 'refused');
    assert.match(refused.kind === 'refused' ? refused.sentence : '', /SecurityError/);
  });
});

describe('the bytes a room can carry', () => {
  it('refuses a NUL byte and bytes that are not UTF-8, and decodes the rest', () => {
    assert.equal(decodableText(new TextEncoder().encode('plain text\n')), 'plain text\n');
    assert.equal(decodableText(new Uint8Array([0x61, 0x00, 0x62])), undefined);
    assert.equal(decodableText(new Uint8Array([0xff, 0xfe, 0x61])), undefined);
    assert.equal(decodableText(new TextEncoder().encode('héllo — ✓')), 'héllo — ✓');
  });
});

describe('the create, which is a name the host typed', () => {
  it('makes a file the walk then lists, and writes no bytes doing it', async () => {
    const { folder, tree, log } = projection(dir({ 'README.md': file('r') }));
    await folder.list();
    assert.deepEqual(await folder.create('notes.md', 'file'), {
      kind: 'created',
      path: 'notes.md',
      entry: 'file',
    });
    // The folder holds it, so the room's own walk publishes it; the create itself wrote nothing.
    assert.ok((tree.children['notes.md'] as FileNode).text === '');
    assert.deepEqual(log.writes, []);
    assert.deepEqual(await folder.list(), ['README.md', 'notes.md']);
  });

  it('serves the file it just made, before the caller re-walks', async () => {
    // The listing the room is told comes from a walk the caller makes next, and the read a peer
    // makes is served from the set the walk left behind. A create that did not join that set would
    // publish a path its own read then refused.
    const { folder } = projection(dir({}));
    await folder.list();
    assert.equal((await folder.create('notes.md', 'file')).kind, 'created');
    assert.deepEqual(await folder.read('notes.md'), { kind: 'text', text: '' });
  });

  it('makes a file inside a directory the folder already holds', async () => {
    const { folder, tree } = projection(dir({ 'src': dir({ 'main.ts': file('m') }) }));
    assert.equal((await folder.create('src/notes.md', 'file')).kind, 'created');
    assert.ok('notes.md' in (tree.children['src'] as DirNode).children);
    assert.deepEqual(await folder.list(), ['src/main.ts', 'src/notes.md']);
  });

  it('makes a directory, which the listing is not', async () => {
    // A room's listing is files (`PROTOCOL.md` §5): a directory is published by the files inside
    // it, so this one is in the folder and in no listing, which is what the row's sentence says.
    const { folder, tree } = projection(dir({ 'README.md': file('r') }));
    await folder.list();
    assert.equal((await folder.create('docs', 'directory')).kind, 'created');
    assert.equal((tree.children['docs'] as DirNode).kind, 'directory');
    assert.deepEqual(await folder.list(), ['README.md']);
  });

  it('stamps the file it made, so the room can save into it', async () => {
    // Without the stamp taken from the read-back the write guard refuses the page's own new file
    // as `unread`, and a fresh room's first file is exactly the one a host then types into.
    const { folder, tree } = projection(dir({}));
    await folder.list();
    await folder.create('notes.md', 'file');
    assert.equal(folder.stampOf('notes.md'), (tree.children['notes.md'] as FileNode).lastModified);
    assert.deepEqual(await folder.write('notes.md', 'typed into the room\n'), { kind: 'written' });
    assert.equal((tree.children['notes.md'] as FileNode).text, 'typed into the room\n');
  });

  it('refuses a name the room may not share, in the words sharing it uses', async () => {
    const { folder } = projection(dir({ '.env': file('S=1') }));
    for (const path of ['.env', '../outside.txt', '/etc/passwd', 'a\\b', '.git/config', 'x'.repeat(5000)]) {
      const outcome = await folder.create(path, 'file');
      assert.equal(refusalCause(outcome), 'not-granted', `${path} was not refused`);
    }
    assert.match(folderCreateSentence('not-granted', '.env'), /is not a path this room shares/);
  });

  it('refuses a file name that declares a format a room cannot carry', async () => {
    const { folder, tree } = projection(dir({}));
    for (const path of ['logo.png', 'bundle.zip', 'archive.tar.gz']) {
      assert.equal(refusalCause(await folder.create(path, 'file')), 'binary');
    }
    // The rule is about the format a file's name declares, so a directory may wear the name.
    assert.equal((await folder.create('assets.png', 'directory')).kind, 'created');
    assert.equal((tree.children['assets.png'] as DirNode).kind, 'directory');
    assert.match(folderCreateSentence('binary', 'logo.png'), /declares a format a room cannot carry/);
  });

  it('will not overwrite or adopt a name the folder already holds', async () => {
    const { folder, tree, log } = projection(
      dir({ 'notes.txt': file('kept\n'), 'src': dir({ 'main.ts': file('m') }) }),
    );
    assert.equal(refusalCause(await folder.create('notes.txt', 'file')), 'exists');
    assert.equal(refusalCause(await folder.create('notes.txt', 'directory')), 'exists');
    // The other direction too: a directory is not replaced by a file of its name, and a file is
    // not replaced by a directory of it.
    assert.equal(refusalCause(await folder.create('src', 'file')), 'exists');
    assert.equal(refusalCause(await folder.create('src', 'directory')), 'exists');
    assert.equal((tree.children['notes.txt'] as FileNode).text, 'kept\n');
    assert.deepEqual(log.writes, []);
    assert.match(folderCreateSentence('exists', 'notes.txt'), /already in the folder/);
  });

  it('refuses a path whose directory is not there, rather than making a tree', async () => {
    const { folder, tree } = projection(dir({ 'notes.txt': file('n') }));
    assert.equal(refusalCause(await folder.create('docs/notes.md', 'file')), 'missing');
    assert.equal((tree.children['docs'] as TreeNode | undefined), undefined);
    // A segment that is a file is not a directory to walk through either.
    assert.equal(refusalCause(await folder.create('notes.txt/inner.md', 'file')), 'not-a-file');
    assert.match(folderCreateSentence('missing', 'docs/notes.md'), /has to exist/);
  });

  it('says the person lost write access rather than blaming the name', async () => {
    const locked: FolderDirectoryHandle = {
      kind: 'directory',
      name: 'project',
      async *values() {},
      async getDirectoryHandle() {
        throw domError('NotFoundError');
      },
      async getFileHandle(_name: string, options?: { create?: boolean }) {
        if (options?.create === true) {
          throw domError('NotAllowedError');
        }
        throw domError('NotFoundError');
      },
    };
    const folder = new FolderWorkingCopy(locked);
    const outcome = await folder.create('notes.md', 'file');
    assert.equal(refusalCause(outcome), 'not-permitted');
    assert.match(folderCreateSentence('not-permitted', 'notes.md'), /write access/);
  });

  it('leaves a failure it cannot name to the caller rather than guessing at one', async () => {
    const odd: FolderDirectoryHandle = {
      kind: 'directory',
      name: 'project',
      async *values() {},
      async getDirectoryHandle() {
        throw domError('NotFoundError');
      },
      async getFileHandle(_name: string, options?: { create?: boolean }) {
        if (options?.create === true) {
          throw domError('QuotaExceededError');
        }
        throw domError('NotFoundError');
      },
    };
    const folder = new FolderWorkingCopy(odd);
    await assert.rejects(() => folder.create('notes.md', 'file'), /QuotaExceededError/);
  });
});

function refusalCause(outcome: { kind: string; cause?: string }): string {
  return outcome.kind === 'refused' ? outcome.cause ?? '' : outcome.kind;
}
