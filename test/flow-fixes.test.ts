/**
 * Flow-review regressions: what a landing says, what the room knows about a
 * file, the drop signal reaches the page as a notice, duplicate names
 * disambiguate, the join URL persists, unreachable servers read plainly, and
 * tree directories keep their openness.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding } from '../src/browser/editor.ts';
import { rosterLabel } from '../src/browser/names.ts';
import { persistJoinUrl } from '../src/browser/share.ts';
import {
  EMPTY_FILE_TITLE,
  EMPTY_IN_ROOM_TITLE,
  IN_THE_ROOM_TITLE,
  NOT_HERE_TAG,
  NOT_READ_TITLE,
  NOT_SENT_TITLE,
  dirOpen,
  roomMark,
  rowsKey,
} from '../src/browser/tree-state.ts';
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

  it('a follow re-land raises the indicator and no sentence of its own', async () => {
    // The strip above the editor carries who is followed and where the caret went, so a status
    // sentence saying the same thing was one line too many.
    const overrides = {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'a.txt', selection: selectionAt(1) } }],
      resolved: { anchor: 0, head: 1 },
    };
    const { binding, engine, notices } = setup(new Map([['a.txt', 'aaa'], ['b.txt', 'bbb']]), overrides);
    await binding.follow('peer-sam');
    assert.ok(notices.some((notice) => notice.kind === 'follow' && notice.following?.peerId === 'peer-sam'));
    assert.equal(
      notices.some((notice) => notice.kind === 'status' && notice.text.includes('Following')),
      false,
      `a follow sentence survived in ${JSON.stringify(notices)}`,
    );
    overrides.presence = [{ clientId: 7, peer: SAM, state: { path: 'b.txt', selection: selectionAt(1) } }];
    engine.__emit({ type: 'presenceChanged' });
    await waitFor(
      'the re-land',
      () => (notices.filter((notice) => notice.kind === 'follow').length >= 3 ? true : undefined),
    );
    assert.equal(binding.currentPath(), 'b.txt');
    binding.dispose();
  });
});

describe('what a row says about the room', () => {
  it('a listed path nobody sent reads unpublished; a held one does not', async () => {
    const { binding } = setup(new Map([['a.txt', 'aaa']]), { grant: ['a.txt', 'todo.txt'] });
    assert.equal(binding.isUnpublished('todo.txt'), true);
    assert.equal(binding.isUnpublished('a.txt'), false);
    // Opening the unpublished path still opens it — empty, honestly.
    await binding.openDocument('todo.txt');
    assert.equal(binding.currentPath(), 'todo.txt');
    binding.dispose();
  });

  it('the room’s own open set is what the `●` is drawn from, and the text from what is here', async () => {
    const { binding, overrides } = setup(new Map([['a.txt', 'aaa']]), { held: ['a.txt'] });
    assert.equal(binding.isOpenInRoom('a.txt'), true);
    assert.equal(binding.isOpenInRoom('b.txt'), false);
    assert.equal(binding.hasText('a.txt'), true);
    assert.equal(binding.hasText('b.txt'), false);
    // A path the room holds whose text has not arrived is not an empty file: nothing has been sent
    // and nothing has been read, so the row says that rather than claiming the file is empty.
    overrides.held = ['a.txt', 'b.txt'];
    // A path with no text here is not an empty file and does not claim to be one: `isTextEmpty` is
    // about text this window holds, and what the row says about a path with none is `roomMark`'s.
    assert.equal(binding.isTextEmpty('b.txt'), false);
    assert.deepEqual(roomMark({ inRoom: true, textHere: false, textEmpty: false, host: false }), {
      kind: 'not-here',
      title: NOT_SENT_TITLE,
    });
    assert.deepEqual(roomMark({ inRoom: true, textHere: false, textEmpty: false, host: true }), {
      kind: 'not-here',
      title: NOT_READ_TITLE,
    });
    assert.deepEqual(roomMark({ inRoom: true, textHere: true, textEmpty: false, host: false }), {
      kind: 'in-room',
      title: IN_THE_ROOM_TITLE,
    });
    assert.deepEqual(roomMark({ inRoom: false, textHere: true, textEmpty: false, host: false }), {
      kind: 'none',
    });
    binding.dispose();
  });

  it('an open the room has not answered holds no text, whatever the editor is showing', async () => {
    // B1's other half, at the layer the row's ⤓ reads its decision from. `openDocument` builds the
    // model out of the engine's `text(path)`, and for a guest that text is `''` until the room
    // answers — `open` takes a hold and returns. So the file is in front of the editor and empty,
    // and the window still holds *nothing*: `hasText` is false, which is what tells a fetch from the
    // person's own copy. The defect was that the row asked whether the document was in front of the
    // editor instead of this, and saved the empty model as the file.
    const texts = new Map();
    const { binding, engine } = setup(texts, { held: ['notes.md'], grant: ['notes.md'] });
    await binding.openDocument('notes.md');
    assert.equal(binding.currentPath(), 'notes.md', 'the path is not the one in front of the editor');
    assert.equal(binding.text('notes.md'), '', 'the model of an unanswered open is not empty');
    assert.equal(binding.hasText('notes.md'), false, 'an unanswered open reads as the room’s answer');
    // And when the room does answer it is the same path that holds it: the receipt is the document's
    // arrival, not the open.
    texts.set('notes.md', '# room notes\n');
    assert.equal(binding.hasText('notes.md'), true, 'the arrival of the answer left the path unheld');
    assert.equal(engine.text('notes.md'), '# room notes\n');
    binding.dispose();
  });

  it('`empty` is kept for text the room sent and which is empty', () => {
    assert.equal(EMPTY_FILE_TITLE, 'The file is empty.');
    assert.equal(EMPTY_IN_ROOM_TITLE, 'The room sent its text, and it is empty.');
    // The state that used to borrow the tag: the room holds the path open and nothing has arrived.
    assert.equal(NOT_HERE_TAG, 'not fetched yet');
    assert.deepEqual(roomMark({ inRoom: true, textHere: true, textEmpty: true, host: false }), {
      kind: 'empty',
      title: EMPTY_IN_ROOM_TITLE,
    });
    assert.deepEqual(roomMark({ inRoom: true, textHere: true, textEmpty: true, host: true }), {
      kind: 'empty',
      title: EMPTY_FILE_TITLE,
    });
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
        "Couldn\u2019t reach the session. Check your connection and retry.",
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
  const chrome = {
    current: 'src/main.ts',
    touch: false,
    draft: '',
    local: '',
    unsaved: '',
    hostAway: false,
    marks: 'src/main.ts:in-room\nsrc/lib.ts:',
  };

  it('is a function of the listing and the row chrome', () => {
    const key = rowsKey(['src/main.ts', 'src/lib.ts'], chrome);
    // The same rows and the same chrome read the same, whatever else moved: this is
    // what lets a presence frame repaint badges instead of rebuilding the tree.
    assert.equal(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome }), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts', 'src/new.ts'], chrome), key);
    assert.notEqual(rowsKey(['src/lib.ts', 'src/main.ts'], chrome), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, current: 'src/lib.ts' }), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, touch: true }), key);
    // The create row, the folders this session made, a refused write and the host's absence are all
    // row chrome: a frame that changes one of them has to redraw the rows it changed.
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, draft: 'file:src' }), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, local: 'docs' }), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, unsaved: 'src/main.ts' }), key);
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, hostAway: true }), key);
    // A row's own mark is chrome too: the room picking a document up changes what every row says
    // while the listing reads the same.
    assert.notEqual(rowsKey(['src/main.ts', 'src/lib.ts'], { ...chrome, marks: 'src/main.ts:empty' }), key);
  });

  it('separates the row chrome from the listing', () => {
    // The parts cannot be read as one another: a path carries no NUL and no line feed
    // (a name with a control character is not a granted path), and the chrome's own
    // fields come before the listing's.
    const blank = { ...chrome, current: undefined };
    assert.notEqual(rowsKey(['a'], blank), rowsKey([], { ...blank, current: 'a' }));
    assert.notEqual(rowsKey([], blank), rowsKey([], { ...blank, draft: 'file:' }));
    assert.notEqual(rowsKey([], blank), rowsKey([], { ...blank, local: 'docs' }));
  });
});
