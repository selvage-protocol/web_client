/**
 * The page's host half in the binding: the folder is where a host's documents come from and
 * where the room's settled text goes, and both directions are the ones a guest does not have.
 *
 * The doubles are the two structural things the binding is written against — the engine and the
 * working copy — so the whole adapter runs without a browser. The last test drives the real
 * bridge between them, because the sentence a refused write produces is only worth anything if
 * it is the one that reaches the person.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FolderWorkingCopy } from '../src/browser/folder.ts';
import type { FolderDirectoryHandle, FolderEntry, FolderWrite } from '../src/browser/folder.ts';
import { MonacoBinding } from '../src/browser/editor.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
globalThis.document = {
  createElement: () => ({ append: () => {}, remove: () => {} }),
  head: { appendChild: () => {} },
};

type Role = 'host' | 'guest';

function makeModel(text: string) {
  const listeners = new Set<() => void>();
  let current = text;
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => current,
    getEOL: () => '\n',
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    getOffsetAt: (position: { column: number }) => position.column - 1,
    pushEditOperations: (
      _before: unknown,
      edits: Array<{ text: string; range: { startColumn: number; endColumn: number } }>,
    ) => {
      for (const edit of edits) {
        const from = edit.range.startColumn - 1;
        const to = edit.range.endColumn - 1;
        current = current.slice(0, from) + edit.text + current.slice(to);
      }
      return null;
    },
    onDidChangeContent: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    __setText: (next: string) => void (current = next),
    __fire: () => void listeners.forEach((listener) => listener()),
  };
}

function makeEditor() {
  return {
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: () => {},
    updateOptions: () => {},
    focus: () => {},
    getOption: () => ({ verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }),
  };
}

/** An engine double whose replica is a map, and whose events the test fires itself. */
function makeEngine(role: Role, texts: Map<string, string>) {
  const listeners = new Set<(event: { type: string; path?: string }) => void>();
  const inserts: Array<[string, string]> = [];
  return {
    session: () => ({
      role,
      roomId: 'r-test',
      token: 'tok',
      peer: { peer_id: 'self', display_name: 'self', role },
      documents: [],
    }),
    text: (path: string) => texts.get(path) ?? '',
    has: (path: string) => texts.has(path),
    open: async () => {},
    close: async () => {},
    openDocuments: () => [],
    insert: (path: string, _index: number, text: string) => {
      inserts.push([path, text]);
      texts.set(path, (texts.get(path) ?? '') + text);
    },
    delete: () => {},
    setSelection: () => {},
    setAwareness: () => {},
    presence: () => [],
    resolveSelection: () => undefined,
    on: (listener: (event: { type: string; path?: string }) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** A peer's edit arriving, as the room delivers it. */
    __peerEdit: (path: string, text: string) => {
      texts.set(path, text);
      listeners.forEach((listener) => listener({ type: 'documentChanged', path }));
    },
    inserts,
  };
}

/** A folder as the page's own read of it: the real working copy over a fake set of files. */
function makeFolder(files: Record<string, string>, options: { refuseRead?: boolean; refuseWrite?: string } = {}) {
  const reads: string[] = [];
  const writes: Array<[string, string]> = [];
  const nodes = files;
  const handle: FolderDirectoryHandle = {
    kind: 'directory',
    name: 'project',
    async *values(): AsyncIterableIterator<FolderEntry> {
      for (const name of Object.keys(nodes)) {
        yield { name, kind: 'file' as const };
      }
    },
    async getDirectoryHandle() {
      throw new DOMException('not a directory here', 'NotFoundError');
    },
    async getFileHandle(name: string) {
      const text = nodes[name];
      if (text === undefined) {
        throw new DOMException('gone', 'NotFoundError');
      }
      return {
        kind: 'file',
        name,
        async getFile() {
          if (options.refuseRead === true) {
            throw new DOMException('gone', 'NotFoundError');
          }
          return {
            lastModified: 1,
            size: new TextEncoder().encode(text).length,
            arrayBuffer: async () => new TextEncoder().encode(text).buffer,
          };
        },
        async createWritable() {
          let pending = '';
          return {
            write: async (data: string) => void (pending += data),
            close: async () => void writes.push([name, pending]),
          };
        },
      };
    },
  };
  const folder = new FolderWorkingCopy(handle);
  const spied = new Proxy(folder, {
    get(target, property, receiver) {
      if (property === 'read') {
        return async (path: string) => {
          reads.push(path);
          return await target.read(path);
        };
      }
      if (property === 'write') {
        return async (path: string, text: string): Promise<FolderWrite> => {
          if (options.refuseWrite !== undefined) {
            return { kind: 'refused', cause: 'stale', sentence: options.refuseWrite };
          }
          return await target.write(path, text);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { folder: spied, reads, writes };
}

function noticeKinds(notices: Array<{ kind: string; text?: string }>): string[] {
  return notices.map((notice) => notice.kind);
}

describe('the host half of the page', () => {
  it('opens a listed file out of the folder and seeds the room with it', async () => {
    const engine = makeEngine('host', new Map());
    const { folder, reads } = makeFolder({ 'notes.txt': 'from the folder\n' });
    const editor = makeEditor();
    let model: ReturnType<typeof makeModel> | undefined;
    const binding = new MonacoBinding({
      engine,
      editor,
      folder,
      onNotice: () => {},
      createModel: (text) => (model = makeModel(text)),
    });
    await binding.openDocument('notes.txt');

    assert.deepEqual(reads, ['notes.txt'], 'the host did not read its own file for its own open');
    assert.equal(binding.text('notes.txt'), 'from the folder\n');
    // The room has it now, through the bridge's own seed: the open is one read and one insert.
    assert.deepEqual(engine.inserts, [['notes.txt', 'from the folder\n']]);
    binding.dispose();
  });

  it('never reads a folder for a guest, whose document is the room\'s', async () => {
    const engine = makeEngine('guest', new Map([['notes.txt', 'from the room\n']]));
    const { folder, reads } = makeFolder({ 'notes.txt': 'from the folder\n' });
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      folder,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('notes.txt');
    assert.equal(binding.text('notes.txt'), 'from the room\n');
    assert.deepEqual(reads, [], 'a guest read a folder it does not have');
    binding.dispose();
  });

  it('leaves a path the room already holds to the room, not to the disk', async () => {
    const engine = makeEngine('host', new Map([['notes.txt', 'the room edited this\n']]));
    const { folder, reads } = makeFolder({ 'notes.txt': 'the disk still says this\n' });
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      folder,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('notes.txt');
    assert.equal(binding.text('notes.txt'), 'the room edited this\n');
    assert.deepEqual(reads, [], 'a host put its disk copy over the room\'s text');
    binding.dispose();
  });

  it('says why a file it cannot read did not open, and leaves the buffer empty', async () => {
    const engine = makeEngine('host', new Map());
    const { folder } = makeFolder({ 'notes.txt': 'from the folder\n' }, { refuseRead: true });
    const editor = makeEditor();
    const notices: Array<{ kind: string; text?: string }> = [];
    const binding = new MonacoBinding({
      engine,
      editor,
      folder,
      onNotice: (notice) => void notices.push(notice),
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('notes.txt');
    assert.equal(binding.text('notes.txt'), '');
    const failure = notices.find((notice) => notice.kind === 'failure');
    assert.ok(failure !== undefined, `nothing was said about the refusal: ${JSON.stringify(notices)}`);
    assert.match(failure.text ?? '', /notes\.txt/, 'the sentence does not name the file');
    binding.dispose();
  });

  it('writes what the room settled on, once the file it read is the file it writes', async () => {
    const engine = makeEngine('host', new Map());
    const { folder, writes, reads } = makeFolder({ 'notes.txt': 'from the folder\n' });
    const editor = makeEditor();
    let model: ReturnType<typeof makeModel> | undefined;
    const binding = new MonacoBinding({
      engine,
      editor,
      folder,
      onNotice: () => {},
      createModel: (text) => (model = makeModel(text)),
    });
    // The host's own open is the read the guard needs: it is the one that sees the stamp.
    await binding.openDocument('notes.txt');
    assert.deepEqual(reads, ['notes.txt']);
    // The room settles on something else — a guest's edit — and the host writes it out.
    model?.__setText('from the folder\nand one more line\n');
    assert.equal(await binding.save('notes.txt'), true);
    assert.deepEqual(writes, [['notes.txt', 'from the folder\nand one more line\n']]);
    binding.dispose();
  });

  it('refuses a write for a path this page never read, rather than overwriting text it never saw', async () => {
    const engine = makeEngine('host', new Map([['notes.txt', 'settled\n']]));
    const { folder, writes, reads } = makeFolder({ 'notes.txt': 'settled\n' });
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      folder,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    // The room already held the path, so the disk was never read and there is no stamp to
    // compare: the write is refused rather than landing on text nothing here has looked at.
    await binding.openDocument('notes.txt');
    assert.deepEqual(reads, []);
    await assert.rejects(() => binding.save('notes.txt'), /had not been read from the folder/);
    assert.deepEqual(writes, [], 'a write landed for a path the page never read');
    binding.dispose();
  });

  it('reports a refused write as a failure rather than a shuffled-in status line', () => {
    const engine = makeEngine('guest', new Map());
    const editor = makeEditor();
    const notices: Array<{ kind: string; text?: string }> = [];
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: (notice) => void notices.push(notice),
      createModel: (text) => makeModel(text),
    });
    binding.report({ kind: 'saveFailed', path: 'notes.txt', message: 'notes.txt changed on disk.' });
    assert.deepEqual(noticeKinds(notices), ['failure']);
    assert.match(notices[0]?.text ?? '', /changed on disk/);
    binding.dispose();
  });

  it('throws the folder\'s own sentence when a save is refused, so the bridge can carry it', async () => {
    const engine = makeEngine('host', new Map());
    const { folder } = makeFolder({ 'notes.txt': 'a\n' }, { refuseWrite: 'notes.txt changed on disk since the room read it.' });
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      folder,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('notes.txt');
    await assert.rejects(
      () => binding.save('notes.txt'),
      /changed on disk since the room read it/,
      'a refused save did not carry the reason the bridge reports',
    );
    binding.dispose();
  });

  it('carries a refused write all the way to the person: the guard, the bridge, the sentence', async () => {
    // The one chain that matters: a peer edits, the room settles, the host writes, the folder
    // refuses because the file moved, and the person is told. The bridge's own save policy runs
    // on real timers here, so this waits on the notice with a deadline rather than a sleep.
    const engine = makeEngine('host', new Map([['notes.txt', 'room\n']]));
    const { folder, writes } = makeFolder(
      { 'notes.txt': 'room\n' },
      { refuseWrite: 'notes.txt changed on disk since the room read it, so it was left alone.' },
    );
    const editor = makeEditor();
    const notices: Array<{ kind: string; text?: string }> = [];
    const binding = new MonacoBinding({
      engine,
      editor,
      folder,
      onNotice: (notice) => void notices.push(notice),
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('notes.txt');
    engine.__peerEdit('notes.txt', 'room, edited\n');

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (notices.some((notice) => notice.kind === 'failure')) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const failure = notices.find((notice) => notice.kind === 'failure');
    assert.ok(
      failure !== undefined,
      `the refused write was never reported: ${JSON.stringify(notices)} (writes ${JSON.stringify(writes)})`,
    );
    assert.match(failure.text ?? '', /changed on disk since the room read it/);
    // The buffer holds the room's text and the folder holds what it held: nothing was clobbered.
    assert.equal(binding.text('notes.txt'), 'room, edited\n');
    assert.deepEqual(writes, []);
    binding.dispose();
  });
});
