/**
 * Roster, follow and grant-tree behaviour, with a fake editor: the follow lands
 * where the peer is, a local edit ends it, a remote apply must not, going
 * somewhere stops it first, and a peer leaving ends it with a sentence.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding } from '../src/browser/editor.ts';
import type { BindingNotice } from '../src/browser/editor.ts';
import { peerColour } from '../src/bridge/index.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
globalThis.document = {
  createElement: () => ({
    append: () => {},
    remove: () => {},
  }),
  head: { appendChild: () => {} },
};

function makeModel(text, languages) {
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
    positions: [],
    revealed: [],
    selection: null,
    models: [],
    createDecorationsCollection: function () {
      return {
        set: (next) => void (this.decorations = next),
        clear: () => void (this.decorations = []),
      };
    },
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: function () {
      return this.selection;
    },
    setModel: function (model) {
      this.models.push(model);
    },
    setPosition: function (position) {
      this.positions.push(position);
      this.selection = {
        selectionStartLineNumber: position.lineNumber,
        selectionStartColumn: position.column,
        positionLineNumber: position.lineNumber,
        positionColumn: position.column,
      };
    },
    revealPositionInCenter: function (position) {
      this.revealed.push(position);
    },
  };
}

const SAM = { peer_id: 'peer-sam', display_name: 'sam', role: 'guest' };
const JO = { peer_id: 'peer-jo', display_name: '', role: 'host' };

function makeEngine(texts, overrides = {}) {
  const listeners = new Set();
  return {
    texts,
    listeners,
    session: () => ({ role: 'guest', roomId: 'r-test', peer: { peer_id: 'self', display_name: 'self', role: 'guest' }, documents: ['notes.txt'] }),
    text: (path) => texts.get(path) ?? '',
    has: (path) => texts.has(path),
    open: async (path) => void (overrides.openPaths ?? []).push(path),
    close: async (path) => void (overrides.closedPaths ?? []).push(path),
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

function selectionAt(offset) {
  return { anchor: { assoc: 0, tname: 'p', item: { client: 1, clock: offset } }, head: { assoc: 0, tname: 'p', item: { client: 1, clock: offset } } };
}

function setup(texts, overrides = {}) {
  const engine = makeEngine(texts, overrides);
  const editor = makeEditor();
  const notices = [];
  const opened = [];
  const models = [];
  overrides.openPaths = [];
  overrides.closedPaths = [];
  const binding = new MonacoBinding({
    engine,
    editor,
    onNotice: (notice) => void notices.push(notice),
    createModel: (text, language) => {
      opened.push(language);
      const model = makeModel(text);
      models.push({ language, model });
      return model;
    },
  });
  return { engine, editor, notices, opened, models, binding, closedPaths: overrides.closedPaths };
}
describe('roster and grant tree', () => {
  it('lists peers with the caret mapping colours and presence paths', () => {
    const { binding } = setup(new Map(), {
      peers: [SAM, JO],
      presence: [
        { clientId: 7, peer: SAM, state: { path: 'notes.txt', selection: selectionAt(2) } },
        { clientId: 9, peer: JO, state: {} },
      ],
    });
    assert.deepEqual(binding.participants(), [
      { peerId: 'peer-sam', displayName: 'sam', role: 'guest', colour: peerColour('peer-sam'), path: 'notes.txt' },
      { peerId: 'peer-jo', displayName: 'peer-jo', role: 'host', colour: peerColour('peer-jo'), path: undefined },
    ]);
    binding.dispose();
  });

  it('opens models in the backed language for the path', async () => {
    const { binding, opened } = setup(new Map([['notes.md', '# hi'], ['main.ts', 'const x = 1;']]));
    await binding.openDocument('notes.md');
    await binding.openDocument('main.ts');
    assert.deepEqual(opened, ['markdown', 'typescript']);
    binding.dispose();
  });

  it('unions the grant with the open documents, directories first', () => {
    const { binding } = setup(new Map([['notes.txt', 'hi']]), {
      grant: ['src/main.ts', 'notes.md'],
    });
    assert.deepEqual(binding.grantListing(), ['notes.md', 'notes.txt', 'src/main.ts']);
    assert.deepEqual(binding.grantTree('').map((child) => [child.name, child.directory]), [
      ['src', true],
      ['notes.md', false],
      ['notes.txt', false],
    ]);
    assert.deepEqual(binding.grantTree('src'), [
      { name: 'main.ts', path: 'src/main.ts', directory: false },
    ]);
    binding.dispose();
  });

  it('reports the grant when the room publishes a listing', async () => {
    const overrides = { grant: ['a.txt'] };
    const { binding, engine, notices } = setup(new Map([['a.txt', 'a']]), overrides);
    overrides.grant.push('b.txt');
    engine.__emit({ type: 'grantChanged', paths: ['a.txt', 'b.txt'] });
    const grant = notices.find((notice) => notice.kind === 'grant');
    assert.deepEqual(grant, { kind: 'grant', paths: ['a.txt', 'b.txt'] });
    binding.dispose();
  });

  it('re-showing a fronted document touches no wire', async () => {
    const overrides = {};
    const { binding } = setup(new Map([['notes.txt', 'hi']]), overrides);
    await binding.openDocument('notes.txt');
    const wired = [...overrides.openPaths];
    // The first showing wires the hold (the binding's open and the bridge's own);
    // showing it again — what every follow frame does — wires nothing.
    assert.ok(wired.length > 0);
    await binding.openDocument('notes.txt');
    assert.deepEqual(overrides.openPaths, wired);
    binding.dispose();
  });
});

describe('follow', () => {
  it('lands where the peer is and raises the indicator', async () => {
    const { binding, notices } = setup(new Map([['notes.txt', 'ab\ncdef\ng']]), {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'notes.txt', selection: selectionAt(5) } }],
      resolved: { anchor: 3, head: 5 },
    });
    await binding.follow('peer-sam');
    // Head 5 is line 2, column 3.
    assert.deepEqual(binding.following(), { peerId: 'peer-sam', name: 'sam', colour: peerColour('peer-sam') });
    assert.ok(notices.some((notice) => notice.kind === 'follow' && notice.following?.peerId === 'peer-sam'));
    binding.dispose();
  });

  it('moves the caret to the resolved head and reveals it', async () => {
    const { binding, editor } = setup(new Map([['notes.txt', 'ab\ncdef\ng']]), {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'notes.txt', selection: selectionAt(5) } }],
      resolved: { anchor: 3, head: 5 },
    });
    await binding.follow('peer-sam');
    assert.deepEqual(editor.positions.at(-1), { lineNumber: 2, column: 3 });
    assert.deepEqual(editor.revealed.at(-1), { lineNumber: 2, column: 3 });
    assert.equal(binding.currentPath(), 'notes.txt');
    binding.dispose();
  });

  it('a local edit ends the follow, a remote apply must not', async () => {
    const texts = new Map([['notes.txt', 'ab\ncdef\ng']]);
    const overrides = {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'notes.txt', selection: selectionAt(5) } }],
      resolved: { anchor: 3, head: 5 },
    };
    const { binding, models, notices } = setup(texts, overrides);
    await binding.follow('peer-sam');
    assert.notEqual(binding.following(), undefined);
    // Remote apply first: the follow survives it.
    assert.equal(await binding.applyChange('notes.txt', { start: 0, end: 0, text: '!' }), true);
    assert.notEqual(binding.following(), undefined);
    // A keystroke — a content change outside a remote apply — ends it.
    const model = models.find((entry) => entry.language === 'plaintext')?.model;
    assert.ok(model !== undefined);
    model.__fire();
    assert.equal(binding.following(), undefined);
    assert.ok(notices.some((notice) => notice.kind === 'follow' && notice.following === undefined));
    binding.dispose();
  });

  it('going somewhere stops following first', async () => {
    const { binding, notices } = setup(new Map([['a.txt', 'aaa'], ['b.txt', 'bbb']]), {
      peers: [SAM, JO],
      presence: [
        { clientId: 7, peer: SAM, state: { path: 'a.txt', selection: selectionAt(1) } },
        { clientId: 9, peer: JO, state: { path: 'b.txt', selection: selectionAt(1) } },
      ],
      resolved: { anchor: 0, head: 1 },
    });
    await binding.follow('peer-sam');
    assert.notEqual(binding.following(), undefined);
    await binding.goTo('peer-jo');
    assert.equal(binding.following(), undefined);
    assert.equal(binding.currentPath(), 'b.txt');
    assert.ok(notices.some((notice) => notice.kind === 'follow' && notice.following === undefined));
    binding.dispose();
  });

  it('answers a go-to with what the attempt came to, not just whether it threw', async () => {
    // The page reads this to know whether the press is over: a landing ends the menu it was
    // pressed in, and anything else leaves it standing for the room's answer.

    // A peer whose caret resolves here: the press landed.
    const landed = setup(new Map([['notes.txt', 'ab\ncdef\ng']]), {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'notes.txt', selection: selectionAt(5) } }],
      resolved: { anchor: 3, head: 5 },
    });
    assert.equal(await landed.binding.goTo('peer-sam'), 'landed');
    // The page is told, so the strip and the tree show the file the press opened.
    assert.ok(landed.notices.some((notice) => notice.kind === 'landed' && notice.path === 'notes.txt'));
    landed.binding.dispose();

    // A peer in a file with no caret to read, as an empty one has: the file opening is the landing.
    // Waiting on a frame an idle peer never sends left the menu standing over it.
    const caretless = setup(new Map([['notes.txt', '']]), {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'notes.txt' } }],
    });
    assert.equal(await caretless.binding.goTo('peer-sam'), 'landed');
    assert.equal(caretless.binding.currentPath(), 'notes.txt');
    caretless.binding.dispose();

    // A peer in a document the room holds, whose caret does not resolve here: the room answered,
    // and there is nowhere to land.
    const unresolved = setup(new Map([['notes.txt', 'ab\ncdef\ng']]), {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'notes.txt', selection: selectionAt(5) } }],
      resolved: undefined,
    });
    assert.equal(await unresolved.binding.goTo('peer-sam'), 'refused');
    unresolved.binding.dispose();

    // A peer the room no longer lists anywhere: the same refusal, in the room's own words.
    const nowhere = setup(new Map(), { peers: [], presence: [] });
    assert.equal(await nowhere.binding.goTo('peer-sam'), 'refused');
    nowhere.binding.dispose();

    // A peer still listed as here with no document open yet: the room has not answered, and the
    // next presence frame is what resolves it.
    const waiting = setup(new Map(), { peers: [SAM], presence: [] });
    assert.equal(await waiting.binding.goTo('peer-sam'), 'waiting');
    waiting.binding.dispose();
  });

  it('a peer leaving ends the follow with a sentence', async () => {
    const overrides = {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'notes.txt', selection: selectionAt(5) } }],
      resolved: { anchor: 3, head: 5 },
    };
    const { binding, engine, notices } = setup(new Map([['notes.txt', 'ab\ncdef\ng']]), overrides);
    await binding.follow('peer-sam');
    overrides.peers = [];
    overrides.presence = [];
    engine.__emit({ type: 'peersChanged', peers: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(binding.following(), undefined);
    // The reason travels with the follow going down, because the segment that stated the follow is
    // what just left the screen and nothing else says why.
    assert.ok(
      notices.some(
        (notice) => notice.kind === 'follow' && notice.following === undefined && notice.ended === 'sam left the room, so following stopped.',
      ),
      `no reason for the follow ending in ${JSON.stringify(notices)}`,
    );
    binding.dispose();
  });
});

describe('a file the host deleted out of the room', () => {
  it('ends the document it was showing, and falls back to nothing in front of the editor', async () => {
    const { binding, editor, closedPaths } = setup(
      new Map([['notes.txt', 'hi'], ['main.ts', 'const x = 1;']]),
      { grant: ['notes.txt', 'main.ts'] },
    );
    await binding.openDocument('notes.txt');
    await binding.openDocument('main.ts');
    assert.equal(binding.currentPath(), 'main.ts');

    binding.dropDocuments(['main.ts']);
    assert.equal(binding.currentPath(), undefined, 'the editor still shows the path that went');
    assert.equal(editor.models.at(-1), null, 'the editor was not left with nothing in front of it');
    // The hold goes with it: the room keys a document by its path, so a document nobody holds is not
    // one the room keeps alive for a file that is not in the folder any more.
    assert.deepEqual(closedPaths, ['main.ts']);
    // The other file is untouched: a deletion lands on the paths that went and no others.
    assert.equal(binding.grantListing().includes('notes.txt'), true);
    binding.dispose();
  });

  it('leaves a document that did not go where it is', async () => {
    const { binding, editor, closedPaths } = setup(
      new Map([['notes.txt', 'hi']]),
      { grant: ['notes.txt'] },
    );
    await binding.openDocument('notes.txt');
    binding.dropDocuments(['somewhere/else.ts']);
    assert.equal(binding.currentPath(), 'notes.txt');
    assert.deepEqual(closedPaths, []);
    binding.dispose();
  });

  it('ends a follow whose file went, and says why', async () => {
    const overrides = {
      peers: [SAM],
      presence: [{ clientId: 7, peer: SAM, state: { path: 'notes.txt', selection: selectionAt(2) } }],
      resolved: { anchor: 1, head: 2 },
    };
    const { binding, notices } = setup(new Map([['notes.txt', 'hi']]), overrides);
    await binding.follow('peer-sam');
    assert.equal(binding.following()?.name, 'sam');
    binding.dropDocuments(['notes.txt']);
    assert.equal(binding.following(), undefined, 'the follow outlived the file');
    assert.ok(
      notices.some(
        (notice) =>
          notice.kind === 'follow' && notice.following === undefined && notice.ended === 'Stopped following sam because the file is gone.',
      ),
      `no reason for the follow ending in ${JSON.stringify(notices)}`,
    );
    binding.dispose();
  });
});
