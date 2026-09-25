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

import { DEFAULT_SAVE_SETTLE_MS } from '../src/bridge/index.ts';

import { FolderWorkingCopy } from '../src/browser/folder.ts';
import type { FolderDirectoryHandle, FolderEntry, FolderWrite } from '../src/browser/folder.ts';
import { MonacoBinding } from '../src/browser/editor.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
globalThis.document = {
  createElement: () => ({ append: () => {}, remove: () => {} }),
  head: { appendChild: () => {} },
};

type Role = 'host' | 'guest';

/**
 * The clock, driven by the test.
 *
 * Both settles the write-back runs on are this one clock — the adapter's own and the bridge's, which
 * the binding hands its timers to — so one `fire()` is one settle and nothing here waits for a real
 * deadline.
 */
class ManualTimers {
  private readonly pending = new Map<number, () => void>();
  private next = 0;
  private readonly delays = new Map<number, number>();

  after(delayMs: number, run: () => void): () => void {
    const id = (this.next += 1);
    this.delays.set(id, delayMs);
    this.pending.set(id, run);
    return () => void this.pending.delete(id);
  }

  /** How many deadlines are waiting. */
  armed(): number {
    return this.pending.size;
  }

  /** Every delay the clock was asked for, so a settle can be pinned by its length. */
  intervals(): number[] {
    return [...this.delays.values()];
  }

  /** Runs everything waiting, as the clock would, in the order it was armed. */
  fire(): void {
    for (const [id, run] of [...this.pending]) {
      this.pending.delete(id);
      run();
    }
  }
}

/**
 * Waits for something a write settles on, with a deadline.
 *
 * A write is a chain of promises and the folder is the only place its outcome shows, so the test
 * waits on the folder rather than counting turns: a fixed number of microtask turns is not the task
 * the write's last `await` arrives on.
 */
async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`waited for ${what} and it never happened`);
}

function makeModel(text: string) {
  const listeners = new Set<() => void>();
  let current = text;
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => current,
    // What Monaco does with a model built from this text: the document's own first ending decides,
    // and it is what the bridge renders a remote edit into.
    getEOL: () => (current.includes('\r\n') ? '\r\n' : '\n'),
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
    insert: (path: string, index: number, text: string) => {
      inserts.push([path, text]);
      const current = texts.get(path) ?? '';
      texts.set(path, current.slice(0, index) + text + current.slice(index));
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

/**
 * The write-back: what a host's own edits do to the folder it shared.
 *
 * Everything here runs on the injected clock, so one `fire()` is one settle and no test waits for a
 * deadline. The folder is the real `FolderWorkingCopy` over a fake handle and the bridge is the real
 * one, so what these drive is the adapter's own policy and nothing else.
 */
describe('the host writes its own edits back', () => {
  /** A host binding over one folder, with the clock and the models the test drives. */
  function harness(
    files: Record<string, string>,
    options: { refuseWrite?: string; texts?: Map<string, string> } = {},
  ) {
    const engine = makeEngine('host', options.texts ?? new Map());
    const { folder, writes, reads } = makeFolder(files, { refuseWrite: options.refuseWrite });
    const timers = new ManualTimers();
    const notices: Array<{ kind: string; text?: string; path?: string }> = [];
    const models: Array<ReturnType<typeof makeModel>> = [];
    const binding = new MonacoBinding({
      engine,
      editor: makeEditor(),
      folder,
      timers,
      onNotice: (notice) => void notices.push(notice),
      createModel: (text) => {
        const model = makeModel(text);
        models.push(model);
        return model;
      },
    });
    return { engine, binding, timers, notices, models, writes, reads };
  }

  it('writes a local edit once, after the settle and not before it', async () => {
    const { binding, timers, models, writes } = harness({ 'notes.txt': 'from the folder\n' });
    await binding.openDocument('notes.txt');
    models[0]?.__setText('from the folder\nand one more line\n');
    models[0]?.__fire();

    assert.deepEqual(timers.intervals().slice(-1), [DEFAULT_SAVE_SETTLE_MS], 'the write is not on the bridge\u2019s settle');
    assert.deepEqual(writes, [], 'the write landed before the settle passed');
    timers.fire();
    await until(() => writes.length === 1, 'the settled write');
    assert.deepEqual(writes, [['notes.txt', 'from the folder\nand one more line\n']]);
    binding.dispose();
  });

  it('arms nothing for a window with no folder, which is every guest', async () => {
    const engine = makeEngine('guest', new Map([['notes.txt', 'from the room\n']]));
    const timers = new ManualTimers();
    const binding = new MonacoBinding({
      engine,
      editor: makeEditor(),
      timers,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('notes.txt');
    assert.ok(
      !timers.intervals().includes(DEFAULT_SAVE_SETTLE_MS),
      'a window with no folder armed a write',
    );
    assert.equal(await binding.save('notes.txt'), true, 'a save with no folder is not a no-op');
    binding.dispose();
  });

  it('writes both files when one settle covers two of them', async () => {
    // The defect this pins: one timer for the whole binding, so "type in A, open B, type in B" inside
    // the settle cancelled A's write and A was never written — nothing re-armed it, and the page has
    // no save gesture and no mark, so the person believed it had landed.
    const { binding, timers, models, writes } = harness({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
    await binding.openDocument('a.txt');
    models[0]?.__setText('a EDITED\n');
    models[0]?.__fire();
    await binding.openDocument('b.txt');
    assert.equal(models.length, 2, 'the two opens did not build two models');
    models[1]?.__setText('b EDITED\n');
    models[1]?.__fire();

    timers.fire();
    await until(() => writes.length === 2, 'both files written');
    assert.deepEqual(
      [...writes].sort(),
      [
        ['a.txt', 'a EDITED\n'],
        ['b.txt', 'b EDITED\n'],
      ],
    );
    binding.dispose();
  });

  it('writes once when a peer\u2019s edit and a local edit land in the same settle', async () => {
    // The ordinary shape of two people typing together: the room's edit arms the bridge's write, the
    // person's keystroke arms the adapter's, and both fire in one tick. Two overlapping writes of one
    // file is what the folder refuses as `stale`, since it reads the stamp before its first `await`.
    const { engine, binding, timers, models, writes } = harness({ 'notes.txt': 'room\n' });
    await binding.openDocument('notes.txt');
    engine.__peerEdit('notes.txt', 'room, edited\n');
    await until(() => timers.armed() > 0, 'the peer\u2019s edit to arm a write');

    // The host types on top of what arrived: the model change re-arms the bridge's write (`moveSave`)
    // and arms the adapter's own, and the two deadlines are the same one.
    models[0]?.__setText('room, edited by both\n');
    models[0]?.__fire();
    timers.fire();

    await until(() => writes.length >= 1, 'the settled write');
    assert.deepEqual(writes, [['notes.txt', 'room, edited by both\n']], 'the settle wrote the file twice');
    binding.dispose();
  });

  it('keeps a CRLF file CRLF when the host edits a file a guest opened first', async () => {
    // The replica is LF whatever the file is (`toCrdt`), so a model built from it alone would put
    // every line back as LF on the host's first keystroke — an edit of one character that changes
    // every line in version control. 0.4.3 did this for a guest's edit through the bridge's render;
    // this is the host's own typing.
    const engine = makeEngine('host', new Map([['notes.txt', 'one\ntwo\n']]));
    const { folder, writes } = makeFolder({ 'notes.txt': 'one\r\ntwo\r\n' });
    const timers = new ManualTimers();
    const models: Array<ReturnType<typeof makeModel>> = [];
    const binding = new MonacoBinding({
      engine,
      editor: makeEditor(),
      folder,
      timers,
      onNotice: () => {},
      createModel: (text) => {
        const model = makeModel(text);
        models.push(model);
        return model;
      },
    });
    // The room's request for the path is what reads the file, and it is what puts the layout on
    // record: a guest's open, served by this host.
    const served = await binding.readGrantedFile('notes.txt');
    assert.deepEqual(served, { kind: 'text', text: 'one\r\ntwo\r\n' });
    // The host's own open now, over a room that already holds the path.
    await binding.openDocument('notes.txt');
    assert.equal(binding.text('notes.txt'), 'one\r\ntwo\r\n', 'the model did not wear the file\u2019s own ending');
    assert.equal(binding.lineEnding('notes.txt'), '\r\n');

    models[0]?.__setText('one\r\ntwo\r\nthree\r\n');
    models[0]?.__fire();
    timers.fire();
    await until(() => writes.length === 1, 'the settled write');
    assert.deepEqual(writes, [['notes.txt', 'one\r\ntwo\r\nthree\r\n']], 'the write flattened the file to LF');
    binding.dispose();
  });

  it('puts the byte order mark back when the file had one', async () => {
    // The reader strips it (`TextDecoder` does), so without this the first edit of a BOM file deletes
    // the mark — and with it the file's own declaration that it is UTF-8.
    const { binding, timers, models, writes } = harness({ 'notes.txt': '\uFEFFone\ntwo\n' });
    await binding.openDocument('notes.txt');
    assert.equal(binding.text('notes.txt'), 'one\ntwo\n', 'the reader left the mark in the buffer');
    models[0]?.__setText('one\ntwo\nthree\n');
    models[0]?.__fire();
    timers.fire();
    await until(() => writes.length === 1, 'the settled write');
    assert.deepEqual(writes, [['notes.txt', '\uFEFFone\ntwo\nthree\n']]);
    binding.dispose();
  });

  it('reaches the person as a failure with its path when the folder refuses the write', async () => {
    const { binding, timers, models, notices } = harness(
      { 'notes.txt': 'from the folder\n' },
      { refuseWrite: 'notes.txt changed on disk since the room read it, so it was left alone.' },
    );
    await binding.openDocument('notes.txt');
    models[0]?.__setText('from the folder\nand one more line\n');
    models[0]?.__fire();
    timers.fire();

    await until(() => notices.some((notice) => notice.kind === 'failure'), 'the refusal to be reported');
    const failure = notices.find((notice) => notice.kind === 'failure');
    assert.equal(failure?.path, 'notes.txt', 'the refusal did not name the row it belongs to');
    assert.match(failure?.text ?? '', /changed on disk since the room read it/);
    binding.dispose();
  });

  it('flushes the keystroke still inside the settle when the binding is disposed', async () => {
    // Room gone, socket dropped, Leave confirmed: the folder handle and the buffer are both still
    // valid at `dispose`, and a dropped keystroke is the person's own text.
    const { binding, timers, models, writes } = harness({ 'notes.txt': 'from the folder\n' });
    await binding.openDocument('notes.txt');
    models[0]?.__setText('from the folder\nand one more line\n');
    models[0]?.__fire();
    assert.deepEqual(writes, [], 'the write landed before the settle passed');

    binding.dispose();
    await until(() => writes.length === 1, 'the flushed write');
    assert.deepEqual(writes, [['notes.txt', 'from the folder\nand one more line\n']]);
    assert.equal(timers.armed(), 0, 'the disposed binding left a timer behind');
  });

  it('says nothing to the page about a write the flush had to make', async () => {
    // The page's chrome is being taken down with the binding: a notice from the flush has no row to
    // mark, and the row's own state is cleared by the page anyway.
    const { binding, timers, models, notices } = harness(
      { 'notes.txt': 'from the folder\n' },
      { refuseWrite: 'notes.txt changed on disk since the room read it, so it was left alone.' },
    );
    await binding.openDocument('notes.txt');
    models[0]?.__setText('from the folder\nand one more line\n');
    models[0]?.__fire();
    binding.dispose();
    await until(() => notices.length > 0 || timers.armed() === 0, 'the flush to have run');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(notices, [], 'a disposed binding reported a write the page cannot show');
  });
});
