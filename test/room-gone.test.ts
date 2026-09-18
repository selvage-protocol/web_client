/**
 * Room-gone terminal state: the roster clears with dead actions, typing
 * echoes the state instead of landing silently, the tree keeps its snapshot
 * marked stale, and this client never hellos as host.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { MonacoBinding } from '../src/browser/editor.ts';
import { renderRoster } from '../src/browser/roster.ts';
import { wireShareBox } from '../src/browser/share-box.ts';
import {
  ROSTER_DISABLED_REASON,
  SHARE_RETIRED_REASON,
  TREE_STALE_NOTE,
  roomGoneMessage,
  visibleListing,
} from '../src/browser/ended.ts';

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
    __setText: (next) => void (text = next),
    __fire: () => void listeners.forEach((listener) => listener()),
  };
}

function makeEngine(texts, overrides = {}) {
  const listeners = new Set();
  const held = [...(overrides.held ?? [])];
  const inserts = [];
  const deletes = [];
  return {
    listeners,
    inserts,
    deletes,
    session: () => ({ role: 'guest', roomId: 'r-test', peer: { peer_id: 'self', display_name: 'self', role: 'guest' }, documents: [...texts.keys()] }),
    text: (path) => texts.get(path) ?? '',
    has: (path) => texts.has(path),
    open: async (path) => void held.push(path),
    close: async (_path) => {},
    openDocuments: () => [...held],
    insert: (path, index, insertText) => void inserts.push([path, index, insertText]),
    delete: (path, index, length) => void deletes.push([path, index, length]),
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
  const readOnly = {};
  const editor = {
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: () => {},
    setPosition: () => {},
    revealPositionInCenter: () => {},
    updateOptions: (next) => void Object.assign(readOnly, next),
  };
  const notices = [];
  let liveModel;
  const binding = new MonacoBinding({
    engine,
    editor,
    onNotice: (notice) => void notices.push(notice),
    createModel: (text) => (liveModel = makeModel(text)),
  });
  return { engine, editor, readOnly, notices, binding, overrides, model: () => liveModel };
}

const SAM = { peer_id: 'peer-sam', display_name: 'sam', role: 'guest' };

describe('room-gone copy', () => {
  it('names the host not returning', () => {
    assert.equal(roomGoneMessage('host did not return'), 'The room is closed — host did not return.');
  });

  it('the retired share and the stale tree name their reasons', () => {
    assert.match(SHARE_RETIRED_REASON, /closed room/);
    assert.match(ROSTER_DISABLED_REASON, /closed/);
    assert.match(TREE_STALE_NOTE, /last listing/);
  });
});

describe('binding past room-gone', () => {
  it('announces the end, clears the roster, and locks the editor', async () => {
    const { binding, notices, readOnly } = setup(new Map([['a.txt', 'aaa']]), {
      peers: [SAM],
      grant: ['a.txt'],
    });
    await binding.openDocument('a.txt');
    binding.report({ kind: 'roomGone', reason: 'host did not return' });
    assert.ok(binding.isTerminal(), 'no terminal flag after room-gone');
    assert.ok(
      notices.some((notice) => notice.kind === 'roomGone' && notice.reason === 'host did not return'),
      `no roomGone notice in ${JSON.stringify(notices)}`,
    );
    assert.deepEqual(binding.participants(), [], 'the roster still lists the room');
    assert.equal(readOnly.readOnly, true, 'the editor still takes typing');
    binding.dispose();
  });

  it('typing past the end echoes the state and sends nothing', async () => {
    // Control: while live the same keystroke publishes to the engine.
    const live = setup(new Map([['a.txt', 'aaa']]), { peers: [SAM], grant: ['a.txt'] });
    await live.binding.openDocument('a.txt');
    live.model().__setText('aaab');
    live.model().__fire();
    assert.ok(live.engine.inserts.length > 0, 'the control keystroke published nothing');
    live.binding.dispose();
    // Past the end the same keystroke echoes the state and sends nothing.
    const { binding, engine, notices, model } = setup(new Map([['a.txt', 'aaa']]), {
      peers: [SAM],
      grant: ['a.txt'],
    });
    await binding.openDocument('a.txt');
    assert.equal(binding.text('a.txt'), 'aaa');
    binding.report({ kind: 'roomGone', reason: 'host did not return' });
    model().__setText('aaab');
    model().__fire();
    assert.ok(
      notices.some(
        (notice) => notice.kind === 'status' && notice.text === 'The room is closed — host did not return.',
      ),
      `no terminal echo in ${JSON.stringify(notices)}`,
    );
    assert.deepEqual(engine.inserts, [], 'a dead-room keystroke reached the engine');
    assert.deepEqual(engine.deletes, [], 'a dead-room keystroke reached the engine');
    // The trailing disconnect adds no live notice on top of the sentence.
    const before = notices.length;
    binding.report({ kind: 'disconnected' });
    assert.ok(
      notices.slice(before).every((notice) => notice.kind === 'disconnected' || notice.kind === 'status'),
      `a live notice survived the end: ${JSON.stringify(notices.slice(before))}`,
    );
    binding.dispose();
  });

  it('go-to and follow past the end refuse with the state', async () => {
    const { binding, notices } = setup(new Map([['a.txt', 'aaa']]), {
      peers: [SAM],
      grant: ['a.txt'],
    });
    binding.report({ kind: 'roomGone', reason: 'host did not return' });
    await assert.rejects(() => binding.goTo('peer-sam'), /closed/);
    await assert.rejects(() => binding.follow('peer-sam'), /closed/);
    assert.deepEqual(binding.participants(), []);
    assert.ok(notices.some((notice) => notice.kind === 'roomGone'));
    binding.dispose();
  });
});

function makeListDocument() {
  function make(tag) {
    const element = {
      tag,
      children: [],
      className: '',
      textContent: '',
      title: '',
      disabled: false,
      style: {},
      dataset: {},
      classes: [],
      classList: { add: (name) => void element.classes.push(name) },
      replaceChildren: () => void element.children.splice(0),
      append: (...nodes) => void nodes.forEach((node) => void element.children.push(node)),
      appendChild: (node) => void element.children.push(node),
      addEventListener: () => {},
      setAttribute: () => {},
    };
    return element;
  }
  return { createElement: (tag) => make(tag) };
}

function buttonsUnder(element) {
  const found = [];
  const walk = (node) => {
    if (node.tag === 'button') found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(element);
  return found;
}

const PEER = { peerId: 'peer-sam', displayName: 'sam', role: 'guest', colour: '#e06c75', path: 'notes.md' };

describe('roster past the end', () => {
  it('every action stays drawn but dead, with the reason', () => {
    globalThis.document = makeListDocument();
    const list = globalThis.document.createElement('ul');
    renderRoster(list, [PEER], {
      followedPeerId: undefined,
      selfName: 'me',
      disabled: true,
      disabledReason: ROSTER_DISABLED_REASON,
      onGoTo: () => {},
      onFollow: () => {},
    });
    const buttons = buttonsUnder(list);
    assert.ok(buttons.length >= 4, `expected self plus peer actions, saw ${buttons.length}`);
    for (const button of buttons) {
      assert.equal(button.disabled, true, 'a live-looking action survived the end');
    }
    const peerRow = list.children.find((child) => child.classes.includes('peer'));
    for (const button of buttonsUnder(peerRow)) {
      assert.equal(button.title, ROSTER_DISABLED_REASON, `no reason on a dead action: ${button.title}`);
    }
  });

  it('the live roster still offers its verbs', () => {
    globalThis.document = makeListDocument();
    const list = globalThis.document.createElement('ul');
    renderRoster(list, [PEER], {
      followedPeerId: undefined,
      selfName: 'me',
      onGoTo: () => {},
      onFollow: () => {},
    });
    const peerRow = list.children.find((child) => child.classes.includes('peer'));
    const buttons = buttonsUnder(peerRow);
    assert.equal(buttons[1].disabled, false);
    assert.equal(buttons[1].title, '');
  });
});

function makeShareDocument() {
  function make(tag) {
    const element = {
      tag,
      children: [],
      className: '',
      textContent: '',
      title: '',
      attributes: {},
      classes: [],
      classList: {
        add: (name) => void (element.classes.includes(name) || element.classes.push(name)),
        remove: (name) => void (element.classes = element.classes.filter((known) => known !== name)),
        contains: (name) => element.classes.includes(name),
      },
      handlers: {},
      addEventListener: (type, listener) => void ((element.handlers[type] ??= []).push(listener)),
      appendChild: (node) => void element.children.push(node),
      append: (...nodes) => void nodes.forEach((node) => void element.children.push(node)),
      replaceChildren: (...nodes) => void (element.children = [...nodes]),
      setAttribute: (name, value) => void (element.attributes[name] = value),
      fire: (type, event = {}) => void (element.handlers[type] ?? []).forEach((fn) => fn(event)),
      ownerDocument: null,
    };
    element.ownerDocument = { createElement: (childTag) => make(childTag) };
    return element;
  }
  return { createElement: (tag) => make(tag) };
}

describe('share link past the end', () => {
  it('a retired bar copies nothing and confirms nothing', () => {
    const document = makeShareDocument();
    const group = document.createElement('div');
    const calls = [];
    const box = wireShareBox(group, () => void calls.push('copy'), {
      schedule: () => {},
    });
    box.retire(SHARE_RETIRED_REASON);
    group.fire('click', {});
    let prevented = 0;
    group.fire('keydown', { key: 'Enter', preventDefault: () => void (prevented += 1) });
    assert.deepEqual(calls, [], 'a dead link reached the clipboard');
    assert.equal(prevented, 0);
    box.confirm();
    assert.ok(!group.classList.contains('copied'), 'a dead link confirmed a copy');
    assert.equal(group.attributes['aria-disabled'], 'true');
  });
});

describe('stale tree rule', () => {
  it('past the end the snapshot stands even when the live view is empty', () => {
    assert.deepEqual(visibleListing(true, ['demo.ts', 'notes.md', 'todo.txt'], []), [
      'demo.ts',
      'notes.md',
      'todo.txt',
    ]);
  });

  it('while live the listing follows the room', () => {
    assert.deepEqual(visibleListing(false, ['demo.ts'], ['notes.md']), ['notes.md']);
  });
});

describe('no host hello from this client', () => {
  it('no browser source hellos as host or mints a room', () => {
    const base = new URL('../src/browser/', import.meta.url);
    const hits = [];
    for (const file of readdirSync(base)) {
      if (!file.endsWith('.ts')) continue;
      const text = readFileSync(new URL(file, base), 'utf8');
      for (const pattern of [/role\s*:\s*['\"]host['\"]/, /\.host\s*\(/, /Engine\.host/]) {
        if (pattern.test(text)) hits.push(`${file} matches ${pattern}`);
      }
    }
    assert.deepEqual(hits, [], `a host-role hello path exists: ${hits.join('; ')}`);
  });
});
