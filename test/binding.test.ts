/**
 * The adapter's only logic is offset mapping: room offsets (UTF-16 code units) to
 * Monaco line/column ranges and back. These tests pin it with a fake editor, on a
 * multi-line document where a line-1-only mapping would fail.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding, SELECTION_INTERVAL_MS } from '../src/browser/editor.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
const appended = [];
globalThis.document = {
  createElement: () => ({
    append: (rule) => appended.push(rule),
    remove: () => {},
  }),
  head: { appendChild: () => {} },
};

function makeModel(text) {
  const listeners = new Set();
  const lines = () => text.split('\n');
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => text,
    getEOL: () => '\n',
    getOffsetAt: (pos) => {
      const ls = lines();
      let offset = 0;
      for (let i = 0; i < pos.lineNumber - 1; i += 1) {
        offset += ls[i].length + 1;
      }
      return offset + pos.column - 1;
    },
    getPositionAt: (offset) => {
      const ls = lines();
      let rest = offset;
      for (let i = 0; i < ls.length; i += 1) {
        if (rest <= ls[i].length) {
          return { lineNumber: i + 1, column: rest + 1 };
        }
        rest -= ls[i].length + 1;
      }
      return { lineNumber: ls.length, column: ls[ls.length - 1].length + 1 };
    },
    pushEditOperations: (_before, edits, _cursor) => {
      const model = { text };
      for (const edit of edits) {
        const at = (p) => {
          const ls = model.text.split('\n');
          let offset = 0;
          for (let i = 0; i < p.lineNumber - 1; i += 1) {
            offset += ls[i].length + 1;
          }
          return offset + p.column - 1;
        };
        const from = at({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn });
        const to = at({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn });
        model.text = model.text.slice(0, from) + edit.text + model.text.slice(to);
      }
      text = model.text;
      return null;
    },
    onDidChangeContent: (listener) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    __fire: () => void listeners.forEach((listener) => listener()),
    __text: () => text,
  };
}

function makeEditor() {
  return {
    decorations: [],
    cleared: 0,
    selection: null,
    createDecorationsCollection: function () {
      return {
        set: (next) => void (this.decorations = next),
        clear: () => {
          this.decorations = [];
          this.cleared += 1;
        },
      };
    },
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: function () {
      return this.selection;
    },
    setModel: () => {},
  };
}

/**
 * The caret interval, driven by the test instead of by the clock: a burst of events is
 * checked without waiting 100 ms for each of them.
 */
class ManualTimers {
  private readonly pending = new Set<() => void>();
  private readonly delays: number[] = [];

  after(delayMs: number, run: () => void): () => void {
    this.delays.push(delayMs);
    this.pending.add(run);
    return () => void this.pending.delete(run);
  }

  /** How many deadlines are waiting. */
  armed(): number {
    return this.pending.size;
  }

  /** Every delay ever asked for, so the interval can be pinned. */
  intervals(): number[] {
    return [...this.delays];
  }

  /** Runs everything waiting, as the clock would. */
  fire(): void {
    for (const run of [...this.pending]) {
      this.pending.delete(run);
      run();
    }
  }
}

function makeEngine(texts) {
  return {
    session: () => ({ role: 'guest', roomId: 'r-test', peer: { peer_id: 'self', display_name: 'self', role: 'guest' }, documents: ['notes.txt'] }),
    text: (path) => texts.get(path) ?? '',
    has: (path) => texts.has(path),
    open: async (_path) => {},
    close: async (_path) => {},
    openDocuments: () => [],
    insert: () => {},
    delete: () => {},
    setSelection: () => {},
    setAwareness: () => {},
    presence: () => [],
    resolveSelection: () => undefined,
    on: () => () => {},
  };
}

describe('MonacoBinding', () => {
  it('opens the room text and applies remote changes across lines', async () => {
    const engine = makeEngine(new Map([['notes.txt', 'ab\ncdef\ng']]));
    const editor = makeEditor();
    const notices = [];
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: (notice) => void notices.push(notice),
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('notes.txt');
    assert.equal(binding.text('notes.txt'), 'ab\ncdef\ng');

    // Replace "cd" (offsets 3..5) with "CD": the range must land on line 2.
    const applied = await binding.applyChange('notes.txt', { start: 3, end: 5, text: 'CD' });
    assert.equal(applied, true);
    assert.equal(binding.text('notes.txt'), 'ab\nCDef\ng');
    binding.dispose();
  });

  it('draws a peer cursor on the right line with the peer name', async () => {
    const engine = makeEngine(new Map([['notes.txt', 'ab\ncdef\ng']]));
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('notes.txt');
    binding.renderCursors([
      {
        peerId: 'p-1',
        label: 'sam',
        role: 'guest',
        path: 'notes.txt',
        anchor: 3,
        head: 5,
        colour: '#112233',
        fill: '#11223344',
      },
    ]);
    // Anchor 3 is line 2 column 1; the caret sits at head 5, line 2 column 3.
    const caret = editor.decorations[0];
    assert.deepEqual(caret.range, {
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 3,
    });
    assert.equal(caret.options.hoverMessage.value, 'sam · guest');
    // The selection rides as a fill; no whole-line marker exists.
    assert.equal(editor.decorations.filter((entry) => entry.options.isWholeLine === true).length, 0);
    const fill = editor.decorations[1];
    assert.deepEqual(fill.range, {
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 3,
    });
    assert.ok(fill.options.inlineClassName.startsWith('selvage-'));
    assert.ok(appended.some((rule) => rule.includes('#112233')));
    binding.dispose();
  });

  it('publishes the local selection as room offsets', async () => {
    const engine = makeEngine(new Map([['notes.txt', 'ab\ncdef\ng']]));
    const selections = [];
    engine.setSelection = (path, selection) => void selections.push([path, selection]);
    const editor = makeEditor();
    let publish;
    editor.onDidChangeCursorSelection = (listener) => {
      publish = listener;
      return { dispose: () => {} };
    };
    const timers = new ManualTimers();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
      timers,
    });
    await binding.openDocument('notes.txt');
    timers.fire();
    selections.length = 0;
    // Line 2, columns 2..4 is offsets 4..6.
    editor.selection = {
      selectionStartLineNumber: 2,
      selectionStartColumn: 2,
      positionLineNumber: 2,
      positionColumn: 4,
    };
    publish();
    timers.fire();
    assert.deepEqual(selections, [['notes.txt', { anchor: 4, head: 6 }]]);
    binding.dispose();
  });

  it('a burst of caret events costs one read of the buffer and one presence frame', async () => {
    const engine = makeEngine(new Map([['notes.txt', 'ab\ncdef\ng']]));
    const selections = [];
    engine.setSelection = (path, selection) => void selections.push([path, selection]);
    const editor = makeEditor();
    let publish;
    editor.onDidChangeCursorSelection = (listener) => {
      publish = listener;
      return { dispose: () => {} };
    };
    const timers = new ManualTimers();
    const model = makeModel('ab\ncdef\ng');
    const inner = model.getValue;
    let reads = 0;
    model.getValue = () => {
      reads += 1;
      return inner();
    };
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: () => model,
      timers,
    });
    await binding.openDocument('notes.txt');
    timers.fire();
    // A held arrow key is a selection event per step, and each one used to copy the whole
    // buffer and put a frame on the wire.
    reads = 0;
    selections.length = 0;
    for (const column of [1, 2, 3, 4, 5]) {
      editor.selection = {
        selectionStartLineNumber: 2,
        selectionStartColumn: column,
        positionLineNumber: 2,
        positionColumn: column,
      };
      publish();
    }
    assert.equal(reads, 0, 'a caret event read the buffer before the interval passed');
    assert.deepEqual(selections, [], 'a caret event published before the interval passed');
    assert.deepEqual(timers.intervals().slice(-1), [SELECTION_INTERVAL_MS]);
    timers.fire();
    assert.equal(reads, 1, 'the flush did not read the buffer exactly once');
    // Where the caret ended, not each step on the way: line 2 column 5 is offset 7.
    assert.deepEqual(selections, [['notes.txt', { anchor: 7, head: 7 }]]);
    binding.dispose();
  });

  it('does not publish the selection a remote apply leaves behind', async () => {
    const engine = makeEngine(new Map([['notes.txt', 'ab\ncdef\ng']]));
    const selections = [];
    engine.setSelection = (path, selection) => void selections.push([path, selection]);
    const editor = makeEditor();
    let publish;
    editor.onDidChangeCursorSelection = (listener) => {
      publish = listener;
      return { dispose: () => {} };
    };
    const timers = new ManualTimers();
    const model = makeModel('ab\ncdef\ng');
    const push = model.pushEditOperations;
    // Monaco raises the selection event from inside the apply: the caret the room's edit
    // moved is this binding's own doing, not the person's.
    model.pushEditOperations = (...args) => {
      const out = push(...args);
      editor.selection = {
        selectionStartLineNumber: 2,
        selectionStartColumn: 1,
        positionLineNumber: 2,
        positionColumn: 1,
      };
      publish();
      return out;
    };
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: () => model,
      timers,
    });
    await binding.openDocument('notes.txt');
    timers.fire();
    selections.length = 0;

    await binding.applyChange('notes.txt', { start: 3, end: 4, text: 'C' });
    assert.equal(timers.armed(), 0, 'the apply armed a caret flush of its own echo');
    timers.fire();
    assert.deepEqual(selections, []);
    binding.dispose();
  });

  it('leaves no caret timer behind when it is disposed', async () => {
    const engine = makeEngine(new Map([['notes.txt', 'ab\ncdef\ng']]));
    const selections = [];
    engine.setSelection = (path, selection) => void selections.push([path, selection]);
    const editor = makeEditor();
    let publish;
    editor.onDidChangeCursorSelection = (listener) => {
      publish = listener;
      return { dispose: () => {} };
    };
    const timers = new ManualTimers();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
      timers,
    });
    await binding.openDocument('notes.txt');
    editor.selection = {
      selectionStartLineNumber: 1,
      selectionStartColumn: 2,
      positionLineNumber: 1,
      positionColumn: 2,
    };
    publish();
    selections.length = 0;
    assert.equal(timers.armed(), 1);
    binding.dispose();
    assert.equal(timers.armed(), 0, 'the interval outlived the binding');
    timers.fire();
    assert.deepEqual(selections, [], 'a disposed binding published a caret');
  });

  it('forwards room reports in page vocabulary', async () => {
    const engine = makeEngine(new Map());
    const editor = makeEditor();
    const notices = [];
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: (notice) => void notices.push(notice),
      createModel: (text) => makeModel(text),
    });
    binding.report({ kind: 'documents', documents: ['a.txt'] });
    binding.report({
      kind: 'peers',
      peers: [{ peer_id: 'p-1', display_name: 'sam', role: 'guest' }],
    });
    binding.report({ kind: 'roomGone', reason: 'host left' });
    assert.deepEqual(notices, [
      { kind: 'documents', documents: ['a.txt'] },
      { kind: 'peers', count: 1, names: ['sam'] },
      { kind: 'status', text: 'room closed: host left' },
      { kind: 'roomGone', reason: 'host left' },
    ]);
    assert.equal(await binding.save('a.txt'), true);
    // The page shares no folder: a read for a peer is refused in the cause that carries no
    // sentence, so even a path guessed at would buy no words confirming it exists.
    assert.deepEqual(await binding.readGrantedFile('a.txt'), {
      kind: 'refused',
      cause: 'not-granted',
    });
    binding.dispose();
  });
});
