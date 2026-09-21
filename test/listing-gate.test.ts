/**
 * The listing gate and the read's gate, from the page's side of the shared source.
 *
 * A host's listing is what a guest is offered and the read is what fills it: a file whose bytes
 * a room cannot carry must not be named in the first and must be refused, in those words, by the
 * second. The formats a name declares are the line both gates draw (`GRANT_BINARY_SUFFIXES`); a
 * name that declares nothing is left to the read, which refuses it with the truth when it is
 * asked for.
 *
 * The path a *peer* guessed at is the other half, and not a wording question: a name the grant
 * would never publish is dropped where it is read, with nothing said at all, so a guessed secret
 * buys no dialog confirming it exists. Both halves are pinned here against the page's own copies
 * — the browser's tree for what a guest is offered, and the shared bridge for what a refusal
 * says — because the page is one of the three clients those copies have to agree across.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding } from '../src/browser/editor.ts';
import { SessionBridge } from '../src/bridge/index.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
globalThis.document = {
  createElement: () => ({
    append: () => {},
    remove: () => {},
  }),
  head: { appendChild: () => {} },
};

function makeModel(text) {
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => text,
    getEOL: () => '\n',
    getPositionAt: (offset) => ({ lineNumber: 1, column: offset + 1 }),
    getOffsetAt: (position) => position.column - 1,
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

/** A window on a room, with the role and the listing the test needs. */
function makeEngine(texts, state) {
  const listeners = new Set();
  return {
    inserted: [],
    session: () => ({
      role: state.role,
      roomId: 'r-test',
      peer: { peer_id: 'self', display_name: 'self', role: state.role },
      documents: [...texts.keys()],
    }),
    text: (path) => texts.get(path) ?? '',
    has: (path) => texts.has(path),
    open: async (_path) => {},
    close: async (_path) => {},
    insert: () => {},
    delete: () => {},
    setSelection: () => {},
    setAwareness: () => {},
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

/**
 * A host window over the shared bridge, with the answer its own read gives for a path. `read` is
 * every path the bridge asked about, in order, and `notices` is what it handed the host.
 */
function hostWindow(answer) {
  const read = [];
  const notices = [];
  const engine = makeEngine(new Map(), { role: 'host', grant: [] });
  const host = {
    text: () => undefined,
    lineEnding: () => 'lf',
    applyChange: async () => true,
    save: async () => true,
    readGrantedFile: async (path) => {
      read.push(path);
      return answer(path);
    },
    renderCursors: () => {},
    report: (notice) => void notices.push(notice),
  };
  const bridge = new SessionBridge({ engine, host });
  return {
    read,
    notices,
    engine,
    bridge,
    /** The refusals alone: the same event also hands the host the room's document set. */
    refusals: () => notices.filter((notice) => notice.kind === 'sessionError'),
    /** The bridge settles its reads on a microtask chain, so a turn of the loop is the wait. */
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

describe('the listing and the read draw the same line', () => {
  it('a path whose name declares a format a room cannot carry is not offered', async () => {
    const texts = new Map([['notes.txt', 'hi']]);
    const state = { role: 'guest', grant: ['notes.txt', 'bundle.zip', 'docs/logo.PNG'] };
    const engine = makeEngine(texts, state);
    const binding = new MonacoBinding({
      engine,
      editor: makeEditor(),
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });

    // The room's listing names all three — a host that has not been updated still does — and
    // the page offers what it can fetch: the guest is not given a row it can never fill.
    assert.deepEqual(binding.grantListing(), ['notes.txt']);
    assert.deepEqual(binding.grantTree(''), [
      { name: 'notes.txt', path: 'notes.txt', directory: false },
    ]);
    assert.deepEqual(binding.grantTree('docs'), []);
    // A document the room holds open is offered too, and by the same rule.
    texts.set('payload.bin', '');
    engine.__emit({ type: 'documentsChanged', documents: ['notes.txt', 'payload.bin'] });
    assert.deepEqual(binding.grantListing(), ['notes.txt']);
    binding.dispose();
  });

  it('a guessed path the grant would never publish is dropped without a word', async () => {
    const window = hostWindow(() => ({ kind: 'refused', cause: 'not-granted' }));
    window.engine.__emit({
      type: 'documentsChanged',
      documents: ['.env', 'id_rsa', '../etc/passwd'],
    });
    await window.settle();
    // `.env`, `id_rsa` and a path out of the folder are names the grant never publishes: nobody
    // is asked about them, so no answer of theirs can confirm that one exists.
    assert.deepEqual(window.read, [], 'a path the grant would never publish was read');
    assert.deepEqual(window.refusals(), [], 'a guessed name was answered');
    window.bridge.dispose();
  });

  it('a grantable path that is nevertheless not granted says nothing either', async () => {
    const window = hostWindow(() => ({ kind: 'refused', cause: 'not-granted' }));
    window.engine.__emit({ type: 'documentsChanged', documents: ['bundle.zip'] });
    await window.settle();
    // The read answered with the cause that carries no sentence: the path passed the shape
    // rules, and the layer that decided it is still not one that says the name out loud.
    assert.deepEqual(window.read, ['bundle.zip'], 'the room asked and was not answered');
    assert.deepEqual(window.refusals(), [], 'a silent cause was spoken');
    window.bridge.dispose();
  });

  it('a binary file the room asks for is refused as binary, not as a deletion', async () => {
    const window = hostWindow(() => ({ kind: 'refused', cause: 'binary' }));
    window.engine.__emit({ type: 'documentsChanged', documents: ['bundle.zip'] });
    await window.settle();
    assert.deepEqual(window.refusals(), [
      {
        kind: 'sessionError',
        code: 'error',
        message:
          'could not share bundle.zip: it is a binary file, and a room carries text, so this is not a file that can be shared at all; nothing was shared for it',
      },
    ]);
    assert.equal(window.engine.has('bundle.zip'), false, 'the refused file entered the replica');
    window.bridge.dispose();
  });
});
