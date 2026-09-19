/**
 * A ghost document: a room that shares no document left the editor editable, so
 * the person typed into a buffer bound to no room document — text nobody saw and
 * nothing published. The binding locks the editor whenever no document is in
 * front of it, and unlocks it the moment one opens.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding } from '../src/browser/editor.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
globalThis.document = {
  createElement: () => ({
    append: () => {},
    remove: () => {},
  }),
  head: { appendChild: () => {} },
};

function makeModel(text) {
  const lines = () => text.split('\n');
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => text,
    getEOL: () => '\n',
    getOffsetAt: (pos) => {
      const ls = lines();
      let offset = 0;
      for (let i = 0; i < pos.lineNumber - 1; i += 1) offset += ls[i].length + 1;
      return offset + pos.column - 1;
    },
    getPositionAt: (offset) => {
      const ls = lines();
      let rest = offset;
      for (let i = 0; i < ls.length; i += 1) {
        if (rest <= ls[i].length) return { lineNumber: i + 1, column: rest + 1 };
        rest -= ls[i].length + 1;
      }
      return { lineNumber: ls.length, column: ls[ls.length - 1].length + 1 };
    },
    onDidChangeContent: () => ({ dispose: () => {} }),
  };
}

function makeEditor() {
  return {
    decorations: [],
    readOnly: undefined,
    updateOptions: function (next) {
      this.readOnly = next.readOnly;
    },
    createDecorationsCollection: function () {
      return {
        set: (next) => void (this.decorations = next),
        clear: () => void (this.decorations = []),
      };
    },
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: () => {},
    setPosition: () => {},
    revealPositionInCenter: () => {},
  };
}

function makeEngine(texts) {
  const listeners = new Set();
  const held = [];
  return {
    session: () => ({
      role: 'guest',
      roomId: 'r-test',
      peer: { peer_id: 'self', display_name: 'self', role: 'guest' },
      documents: [...texts.keys()],
    }),
    text: (path) => texts.get(path) ?? '',
    has: (path) => texts.has(path),
    open: async (path) => void held.push(path),
    close: async () => {},
    openDocuments: () => [...held],
    insert: () => {},
    delete: () => {},
    setSelection: () => {},
    setAwareness: () => {},
    presence: () => [],
    resolveSelection: () => undefined,
    peers: () => [],
    documents: () => [...texts.keys()],
    grantedPaths: () => [],
    on: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

function setup(texts) {
  const engine = makeEngine(texts);
  const editor = makeEditor();
  const binding = new MonacoBinding({
    engine,
    editor,
    onNotice: () => {},
    createModel: (text) => makeModel(text),
  });
  return { engine, editor, binding };
}

describe('a room that shares no document', () => {
  it('leaves the editor read-only until a document opens', async () => {
    const { binding, editor } = setup(new Map());
    assert.equal(binding.currentPath(), undefined, 'a document was in front of the editor');
    assert.equal(editor.readOnly, true, 'the editor takes text the room does not hold');
    // The room's document arrives, by open or by the page's own listing.
    await binding.openDocument('a.txt');
    assert.equal(editor.readOnly, false, 'a document opened and the editor stayed locked');
    binding.dispose();
  });

  it('locks again when the document leaves, and the room being over locks for good', async () => {
    const { binding, editor } = setup(new Map([['a.txt', 'aaa']]));
    await binding.openDocument('a.txt');
    binding.closeDocument('a.txt');
    assert.equal(editor.readOnly, true, 'nothing is in front of the editor and it still takes text');
    binding.report({ kind: 'roomGone', reason: 'host did not return' });
    assert.equal(editor.readOnly, true, 'the editor takes text past the end of the room');
    await binding.openDocument('a.txt');
    assert.equal(editor.readOnly, true, 'a document arriving after the room is over unlocked the editor');
    binding.dispose();
  });
});
