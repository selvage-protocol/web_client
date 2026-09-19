/**
 * Two owner-reported defects, each pinned where its mechanism lives.
 *
 * A ghost document: a room that shares no document left the editor editable, so
 * the person typed into a buffer bound to no room document — text nobody saw and
 * nothing published. The binding locks the editor whenever no document is in
 * front of it, and unlocks it the moment one opens.
 *
 * A ghost caret: a peer's zero-width caret decoration was tracked with Monaco's
 * default stickiness, which widens it over text the local person inserts at the
 * peer's own position — a bar across every line the newlines created, with its
 * glyph-margin badge repeated on each. `renderCursors` now mints the stickiness
 * the desktop client draws with, and the caret is applied to Monaco's own
 * tracked-range function so the pin is on the behaviour, not on the option name.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { IntervalNode, nodeAcceptEdit } from 'monaco-editor/esm/vs/editor/common/model/intervalTree.js';

import { CURSOR_STICKINESS, MonacoBinding } from '../src/browser/editor.ts';

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

function cursor(peerId, label, head, anchor = head) {
  return {
    peerId,
    label,
    role: 'guest',
    path: 'a.txt',
    anchor,
    head,
    colour: '#e06c75',
    fill: '#e06c7540',
  };
}

/**
 * One decoration's range as Monaco tracks it through a local insert at the
 * caret's own offset: the same function the editor's interval tree calls for
 * every decoration when the buffer changes (`intervalTree.js`).
 */
function trackThroughInserts(options, start, end, at, inserts) {
  const node = new IntervalNode(1, start, end);
  node.setOptions(options);
  node.reset(1, start, end, null);
  for (let index = 0; index < inserts; index += 1) {
    nodeAcceptEdit(node, at, at, 1, false);
  }
  return { start: node.start, end: node.end };
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

describe("a peer's caret, while the local person types at it", () => {
  const PEER_OFFSET = 10; // The peer's head, on line 2 of the buffer below.
  const PEER_SELECTION = 5; // The peer's anchor: a selection from here to the head.

  function caretAndFill() {
    const { binding, editor } = setup(new Map([['a.txt', 'ab\ncdef\nghijkl\nmn\n']]));
    return binding.openDocument('a.txt').then(() => {
      binding.renderCursors([cursor('peer-a', 'amy', PEER_OFFSET, PEER_SELECTION)]);
      const caret = editor.decorations.find((entry) => entry.options.hoverMessage !== undefined);
      const fill = editor.decorations.find((entry) => entry.options.inlineClassName !== undefined);
      return { binding, caret, fill };
    });
  }

  it('is drawn as a point, on one line, so one badge can paint', async () => {
    const { binding, caret } = await caretAndFill();
    assert.ok(caret !== undefined, 'no caret decoration was minted');
    assert.equal(caret.range.startLineNumber, caret.range.endLineNumber, 'the caret is not a point');
    assert.equal(caret.range.startColumn, caret.range.endColumn, 'the caret is not a point');
    assert.equal(caret.options.stickiness, CURSOR_STICKINESS);
    binding.dispose();
  });

  it('does not widen over the lines three Enters at it create', async () => {
    const { binding, caret, fill } = await caretAndFill();
    const tracked = trackThroughInserts(caret.options, PEER_OFFSET, PEER_OFFSET, PEER_OFFSET, 3);
    assert.equal(
      tracked.start,
      tracked.end,
      `the caret stretched to ${tracked.start}..${tracked.end} over the typed text`,
    );
    assert.ok(fill !== undefined, 'a selection fill was expected to carry the same rule');
    assert.equal(fill.options.stickiness, CURSOR_STICKINESS);
    const selection = trackThroughInserts(fill.options, PEER_SELECTION, PEER_OFFSET, PEER_OFFSET, 3);
    assert.equal(
      selection.end,
      PEER_OFFSET,
      `the peer's selection swallowed the typed text, ending at ${selection.end}`,
    );
    binding.dispose();
  });

  it('is what Monaco widens without it: the mechanism', () => {
    // The same caret tracked as Monaco tracks one that names no stickiness — the
    // default, `AlwaysGrowsWhenTypingAtEdges`. Three Enters at its position leave the
    // range spanning three offsets, which paints a bar over four lines and one
    // glyph-margin badge for each of them.
    const stretched = trackThroughInserts(
      { className: 'x', stickiness: 0 },
      PEER_OFFSET,
      PEER_OFFSET,
      PEER_OFFSET,
      3,
    );
    assert.equal(stretched.start, PEER_OFFSET);
    assert.equal(stretched.end, PEER_OFFSET + 3, 'Monaco no longer widens a range typed at its edge');
  });
});
