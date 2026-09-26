/**
 * Tree refresh on listing changes: creating a folder and moving a granted
 * entry into it must re-render the tree. The listing is the grant unioned
 * with the open documents, so a `documentsChanged` event alone — no grant
 * event — has to announce the refreshed tree.
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
    pushEditOperations: () => null,
    onDidChangeContent: () => ({ dispose: () => {} }),
  };
}

function makeEditor() {
  return {
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: () => {},
    setPosition: () => {},
    revealPositionInCenter: () => {},
  };
}

function makeEngine(texts, state) {
  const listeners = new Set();
  return {
    listeners,
    session: () => ({ role: 'guest', roomId: 'r-test', peer: { peer_id: 'self', display_name: 'self', role: 'guest' }, documents: [...texts.keys()] }),
    text: (path) => texts.get(path) ?? '',
    has: (path) => texts.has(path),
    open: async (_path) => {},
    close: async (_path) => {},
    openDocuments: () => [...texts.keys()],
    presence: () => [],
    resolveSelection: () => undefined,
    peers: () => [],
    documents: () => [...texts.keys()],
    grantedPaths: () => state.grant,
    on: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    __emit: (event) => void listeners.forEach((listener) => listener(event)),
  };
}

describe('tree refresh on listing changes', () => {
  it('create-then-move re-renders the tree without a grant event', async () => {
    const texts = new Map([['notes.txt', 'hi']]);
    const state = { grant: ['notes.txt'] };
    const engine = makeEngine(texts, state);
    const notices = [];
    const binding = new MonacoBinding({
      engine,
      editor: makeEditor(),
      onNotice: (notice) => void notices.push(notice),
      createModel: (text, _language) => makeModel(text),
    });

    await binding.openDocument('notes.txt');
    assert.deepEqual(binding.grantTree('').map((child) => child.name), ['notes.txt']);
    notices.length = 0;

    // The host creates a folder and moves the entry into it: the open set
    // moves, the grant follows, and the room emits the document set — the
    // tree must refresh on that listing change alone.
    texts.delete('notes.txt');
    texts.set('docs/notes.txt', 'hi');
    state.grant = ['docs/notes.txt'];
    engine.__emit({ type: 'documentsChanged', documents: ['docs/notes.txt'] });

    const grant = notices.find((notice) => notice.kind === 'grant');
    assert.deepEqual(grant, { kind: 'grant', paths: ['docs/notes.txt'] });
    assert.deepEqual(binding.grantListing(), ['docs/notes.txt']);
    assert.deepEqual(
      binding.grantTree(''),
      [{ name: 'docs', path: 'docs', directory: true }],
    );
    assert.deepEqual(binding.grantTree('docs'), [
      { name: 'notes.txt', path: 'docs/notes.txt', directory: false },
    ]);
    binding.dispose();
  });

  it('ends a file the host took out of the grant, and follows one that moved', async () => {
    const texts = new Map([['notes.txt', 'hi'], ['old.txt', 'x']]);
    const state = { grant: ['notes.txt', 'old.txt'] };
    const engine = makeEngine(texts, state);
    const notices = [];
    const binding = new MonacoBinding({
      engine,
      editor: makeEditor(),
      onNotice: (notice) => void notices.push(notice),
      createModel: (text, _language) => makeModel(text),
    });
    await binding.openDocument('notes.txt');

    // A move: the room may still hold the old document, and the listing must not.
    texts.set('docs/notes.txt', 'hi');
    state.grant = ['docs/notes.txt', 'old.txt'];
    engine.__emit({ type: 'grantChanged' });
    assert.deepEqual(binding.grantListing(), ['docs/notes.txt', 'old.txt']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(binding.currentPath(), 'docs/notes.txt', 'the moved file was not followed');
    assert.ok(notices.some((notice) => notice.kind === 'landed' && notice.path === 'docs/notes.txt'));

    // A deletion of a file somebody else has open: gone from this listing too.
    state.grant = ['docs/notes.txt'];
    engine.__emit({ type: 'grantChanged' });
    assert.deepEqual(binding.grantListing(), ['docs/notes.txt']);
    binding.dispose();
  });
});
