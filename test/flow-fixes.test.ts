/**
 * Flow-review regressions: every landing announces itself, unpublished
 * files read as advisories, the drop signal reaches the page as a notice,
 * duplicate names disambiguate, the join URL persists, unreachable servers
 * read plainly, and tree directories keep their openness.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding } from '../src/browser/editor.ts';
import { rosterLabel } from '../src/browser/names.ts';
import { persistJoinUrl } from '../src/browser/share.ts';
import { dirOpen, rowsKey, showUnpublishedBadge, unpublishedPillText } from '../src/browser/tree-state.ts';
import { describeJoinError } from '../src/browser/transport.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
globalThis.document = {
  createElement: () => ({
    append: () => {},
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
    pushEditOperations: () => null,
    onDidChangeContent: (listener) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    __fire: () => void listeners.forEach((listener) => listener()),
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

const SAM = { peer_id: 'peer-sam', display_name: 'sam', role: 'guest' };
const JO = { peer_id: 'peer-jo-9f2k', display_name: 'jo', role: 'host' };

function selectionAt(offset) {
  return { anchor: { assoc: 0, tname: 'p', item: { client: 1, clock: offset } }, head: { assoc: 0, tname: 'p', item: { client: 1, clock: offset } } };
}

function makeEngine(texts, overrides = {}) {
  const listeners = new Set();
  return {
    listeners,
    session: () => ({ role: 'guest', roomId: 'r-test', peer: { peer_id: 'self', display_name: 'self', role: 'guest' }, documents: ['a.txt'] }),
    text: (path) => texts.get(path) ?? '',
    has: (path) => texts.has(path),
    open: async (path) => void (overrides.openPaths ?? []).push(path),
    close: async (_path) => {},
    openDocuments: () => overrides.held ?? [],
    insert: () => {},
    delete: () => {},
    setSelection: () => {},
    setAwareness: () => {},
    presence: () => overrides.presence ?? [],
    resolveSelection: (_path, _selection) => overrides.resolved,
    peers: () => overrides.peers ?? [],
    documents: () => [...texts.keys()],
    grantedPaths: () => overrides.grant ?? [],
    on: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    __emit: (event) => void listeners.forEach((listener) => listener(event)),
  };
}

function setup(texts, overrides = {}) {
  const engine = makeEngine(texts, overrides);
  const editor = makeEditor();
  const notices = [];
  overrides.openPaths = [];
  const binding = new MonacoBinding({
    engine,
    editor,
    onNotice: (notice) => void notices.push(notice),
    createModel: (text, language) => makeModel(text),
  });
  return { engine, editor, notices, binding, overrides };
}

async function waitFor(label, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = predicate();
    if (seen !== undefined) return seen;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('landing notices (tree and editor agree)', () => {
  it('go-to lands with no open: sentence — tree and editor name the file', async () => {
    const { binding, notices } = setup(new Map([['a.txt', 'aaa'], ['b.txt', 'bbb']]), {
      peers: [SAM, JO],
      presence: [{ clientId: 9, peer: JO, state: { path: 'b.txt', selection: selectionAt(1) } }],
      resolved: { anchor: 0, head: 1 },
    });
    await binding.goTo('peer-jo-9f2k');
    assert.equal(binding.currentPath(), 'b.txt');
    assert.ok(
      notices.every((notice) => notice.kind !== 'status' || !notice.text.startsWith('open:')),
      `an open: status survived in ${JSON.stringify(notices)}`,
    );
    binding.dispose();
  });

  it('follow re-lands announce who and where', async () => {
    const overrides = {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'a.txt', selection: selectionAt(1) } }],
      resolved: { anchor: 0, head: 1 },
    };
    const { binding, engine, notices } = setup(new Map([['a.txt', 'aaa'], ['b.txt', 'bbb']]), overrides);
    await binding.follow('peer-sam');
    assert.ok(notices.some((notice) => notice.kind === 'status' && notice.text === 'Following sam in a.txt'));
    overrides.presence = [{ clientId: 7, peer: SAM, state: { path: 'b.txt', selection: selectionAt(1) } }];
    engine.__emit({ type: 'presenceChanged' });
    await waitFor(
      'follow re-land status',
      () => (notices.some((notice) => notice.kind === 'status' && notice.text === 'Following sam in b.txt') ? true : undefined),
    );
    assert.equal(binding.currentPath(), 'b.txt');
    binding.dispose();
  });
});

describe('unpublished files', () => {
  it('a listed path nobody sent reads unpublished; a held one does not', async () => {
    const { binding } = setup(new Map([['a.txt', 'aaa']]), { grant: ['a.txt', 'todo.txt'] });
    assert.equal(binding.isUnpublished('todo.txt'), true);
    assert.equal(binding.isUnpublished('a.txt'), false);
    // Opening the unpublished path still opens it — empty, honestly.
    await binding.openDocument('todo.txt');
    assert.equal(binding.currentPath(), 'todo.txt');
    binding.dispose();
  });

  it('only the open file may wear the unpublished badge — never an unopened one', () => {
    assert.equal(showUnpublishedBadge('todo.txt', 'todo.txt', true), true);
    assert.equal(showUnpublishedBadge('todo.txt', undefined, true), false);
    assert.equal(showUnpublishedBadge('todo.txt', 'notes.md', true), false);
    assert.equal(showUnpublishedBadge('todo.txt', 'todo.txt', false), false);
  });

  it('the pill names the reason on a phone, where its title can never be read', () => {
    // A pointer device hovers the pill and reads the reason; a finger cannot, so
    // the pill itself says who has not shared the file.
    assert.equal(unpublishedPillText(false), 'not yet shared');
    assert.match(unpublishedPillText(true), /host/);
  });
});

describe('drop signal', () => {
  it('the engine reconnecting report reaches the page as its own notice', () => {
    const { binding, notices } = setup(new Map());
    binding.report({ kind: 'reconnecting' });
    assert.ok(
      notices.some((notice) => notice.kind === 'reconnecting'),
      `no reconnecting notice in ${JSON.stringify(notices)}`,
    );
    // It is not a status line: the page's status kind is the transient text with no lifecycle of
    // its own, and this one stands until the room answers.
    assert.equal(
      notices.some((notice) => notice.kind === 'status'),
      false,
      'the drop was reported as a status line',
    );
    binding.dispose();
  });
});

describe('duplicate names', () => {
  it('unique names render plain; taken ones carry a short peer id', () => {
    const solo = [{ displayName: 'sam', peerId: 'peer-sam' }];
    assert.equal(rosterLabel(solo[0], solo), 'sam');
    const pair = [
      { displayName: 'guest-one', peerId: 'peer-aaaa1111' },
      { displayName: 'guest-one', peerId: 'peer-bbbb2222' },
    ];
    assert.equal(rosterLabel(pair[0], pair), 'guest-one · 1111');
    assert.equal(rosterLabel(pair[1], pair), 'guest-one · 2222');
    assert.notEqual(rosterLabel(pair[0], pair), rosterLabel(pair[1], pair));
  });
});

describe('manual join persistence', () => {
  it('the join writes the share link back into the address bar', () => {
    const calls = [];
    persistJoinUrl({ replaceState: (...args) => void calls.push(args) }, 'http://x/?room=r&token=t');
    assert.deepEqual(calls, [[null, '', 'http://x/?room=r&token=t']]);
  });
});

describe('unreachable server copy', () => {
  it('the raw socket error reads plainly with a next step', () => {
    for (const error of [
      new Error('the WebSocket reported an error'),
      new Error('the socket closed before it opened: 1006 '),
    ]) {
      assert.equal(
        describeJoinError(error, 'ws://127.0.0.1:9'),
        "Couldn't reach the session. Check your connection and retry.",
      );
    }
  });

  it('other join failures keep their own message', () => {
    assert.equal(
      describeJoinError(new Error('That invite link does not name a session. Paste the whole link.'), 'ws://h'),
      'That invite link does not name a session. Paste the whole link.',
    );
  });
});

describe('tree directory openness', () => {
  it('pins survive; ancestors of the open file expand; the rest shut', () => {
    const pinned = new Set(['docs']);
    assert.equal(dirOpen('docs', pinned, 'notes.md'), true);
    assert.equal(dirOpen('src', pinned, 'src/main.ts'), true);
    assert.equal(dirOpen('src', new Set(), 'notes.md'), false);
    assert.equal(dirOpen('src', new Set(), undefined), false);
  });
});

describe('what a tree re-render reads', () => {
  it('is a function of the listing and the row chrome', () => {
    const chrome = { current: 'src/main.ts', unpublished: false, touch: false };
    const key = rowsKey(['src/main.ts', 'src/lib.ts'], chrome);
    // The same rows and the same chrome read the same, whatever else moved: this is
    // what lets a presence frame repaint badges instead of rebuilding the tree.
    assert.equal(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome }), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts', 'src/new.ts'], chrome), key);
    assert.notEqual(rowsKey(['src/lib.ts', 'src/main.ts'], chrome), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, current: 'src/lib.ts' }), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, unpublished: true }), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, touch: true }), key);
  });

  it('separates the row chrome from the listing', () => {
    // The parts cannot be read as one another: a path carries no NUL and no line feed
    // (a name with a control character is not a granted path), and the chrome's own
    // fields come before the listing's.
    const chrome = { current: undefined, unpublished: false, touch: false };
    assert.notEqual(rowsKey(['a'], chrome), rowsKey([], { ...chrome, current: 'a' }));
    assert.notEqual(rowsKey([], chrome), rowsKey([], { ...chrome, unpublished: true }));
  });
});
