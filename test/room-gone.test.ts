/**
 * Room-gone behaviour, from the binding up.
 *
 * The binding still ends the session on the room-gone report — the roster
 * empties, the editor goes read-only, and a change that slips through echoes
 * the end rather than publishing into nowhere. The *page* leaves the session on
 * that report and says why on the card, so no resting terminal chrome (a frozen
 * tree, a dead roster, a dead link) is left standing — see
 * `test/session-over.test.ts` for that half.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { MonacoBinding } from '../src/browser/editor.ts';
import { roomGoneMessage } from '../src/browser/ended.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
globalThis.document = {
  createElement: () => ({
    append: () => {},
    remove: () => {},
  }),
  head: { appendChild: () => {} },
} as unknown as Document;

function makeModel(text: string) {
  const listeners = new Set<() => void>();
  const lines = () => text.split('\n');
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => text,
    getEOL: () => '\n',
    getOffsetAt: (pos: { lineNumber: number; column: number }) => {
      const ls = lines();
      let offset = 0;
      for (let i = 0; i < pos.lineNumber - 1; i += 1) offset += ls[i].length + 1;
      return offset + pos.column - 1;
    },
    getPositionAt: (offset: number) => {
      const ls = lines();
      let rest = offset;
      for (let i = 0; i < ls.length; i += 1) {
        if (rest <= ls[i].length) return { lineNumber: i + 1, column: rest + 1 };
        rest -= ls[i].length + 1;
      }
      return { lineNumber: ls.length, column: ls[ls.length - 1].length + 1 };
    },
    pushEditOperations: () => null,
    onDidChangeContent: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    __setText: (next: string) => void (text = next),
    __fire: () => listeners.forEach((listener) => listener()),
  };
}

function makeEngine(texts: Map<string, string>, overrides: Record<string, unknown> = {}) {
  const listeners = new Set<(event: unknown) => void>();
  const held: string[] = [...((overrides.held as string[]) ?? [])];
  const inserts: unknown[] = [];
  const deletes: unknown[] = [];
  return {
    listeners,
    inserts,
    deletes,
    session: () => ({
      role: 'guest',
      roomId: 'r-test',
      peer: { peer_id: 'self', display_name: 'self', role: 'guest' },
      documents: [...texts.keys()],
    }),
    text: (path: string) => texts.get(path) ?? '',
    has: (path: string) => texts.has(path),
    open: async (path: string) => void held.push(path),
    close: async (_path: string) => {},
    openDocuments: () => [...held],
    insert: (path: string, index: number, insertText: string) => void inserts.push([path, index, insertText]),
    delete: (path: string, index: number, length: number) => void deletes.push([path, index, length]),
    setSelection: () => {},
    setAwareness: () => {},
    presence: () => overrides.presence ?? [],
    resolveSelection: (_path: string, _selection: unknown) => overrides.resolved,
    peers: () => overrides.peers ?? [],
    documents: () => [...texts.keys()],
    grantedPaths: () => overrides.grant ?? [],
    on: (listener: (event: unknown) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    __emit: (event: unknown) => void listeners.forEach((listener) => listener(event)),
  };
}

function setup(texts: Map<string, string>, overrides: Record<string, unknown> = {}) {
  const engine = makeEngine(texts, overrides);
  const readOnly: Record<string, unknown> = {};
  const editor = {
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: () => {},
    setPosition: () => {},
    revealPositionInCenter: () => {},
    updateOptions: (next: Record<string, unknown>) => void Object.assign(readOnly, next),
  };
  const notices: Array<{ kind: string; text?: string; reason?: string }> = [];
  let liveModel: ReturnType<typeof makeModel> | undefined;
  const binding = new MonacoBinding({
    engine,
    editor,
    onNotice: (notice) => void notices.push(notice),
    createModel: (text: string) => (liveModel = makeModel(text)),
  } as never);
  return { engine, editor, readOnly, notices, binding, overrides, model: () => liveModel };
}

const SAM = { peer_id: 'peer-sam', display_name: 'sam', role: 'guest' };

describe('room-gone copy', () => {
  it('names the room gone and the cause, the way the desktop clients do', () => {
    assert.equal(roomGoneMessage('host did not return'), 'The room is gone (host did not return).');
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
    live.model()?.__setText('aaab');
    live.model()?.__fire();
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
    model()?.__setText('aaab');
    model()?.__fire();
    assert.ok(
      notices.some(
        (notice) => notice.kind === 'status' && notice.text === 'The room is gone (host did not return).',
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
    await assert.rejects(() => binding.goTo('peer-sam'), /gone/);
    await assert.rejects(() => binding.follow('peer-sam'), /gone/);
    assert.deepEqual(binding.participants(), []);
    assert.ok(notices.some((notice) => notice.kind === 'roomGone'));
    binding.dispose();
  });
});

/**
 * The page never mints a room.
 *
 * The page has one way in. Joining opens somebody else's room from a link and never claims a role:
 * the engine's own default is `guest`, and nothing here overrides it. A room is started in the
 * host's own client, which owns the relay and the folder, so no path in this page picks a folder,
 * asks for a host role or reaches the mint (`host.ts`, `docs/host-run-relay.md`).
 */
describe('the page never mints a room', () => {
  const dir = new URL('../src/browser/', import.meta.url);
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, text: readFileSync(new URL(file, dir), 'utf8') }));

  it('the guest path never claims the host role', () => {
    const hits: string[] = [];
    for (const { file, text } of sources) {
      if (/role\s*:\s*['"]host['"]/.test(text)) hits.push(`${file} names the host role`);
    }
    assert.deepEqual(hits, [], `a browser source asks to be the host: ${hits.join('; ')}`);
  });

  it('reads the sources it claims to cover', () => {
    // A scan that reached no files would report a clean tree.
    assert.ok(sources.length > 15, `the scan reached ${sources.length} browser sources`);
    assert.ok(sources.some(({ file }) => file === 'main.ts'), 'the scan missed the page entry');
  });

  it('leaves the mint to the relay module, and never reaches it', () => {
    // A room is minted in `relay.ts`, which is handed a listing and can be driven by a client that
    // owns a folder. The page entry is not that client: it imports no mint and asks for no folder.
    const mints = sources.filter(({ text }) => /\bhostRoom\s*\(|PeerEngine\.host\s*\(/.test(text));
    assert.deepEqual(
      mints.map(({ file }) => file).sort(),
      ['relay.ts'],
      'the page mints a room of its own',
    );
    const relay = sources.find(({ file }) => file === 'relay.ts')?.text ?? '';
    assert.match(
      relay,
      /export async function hostRoom\([\s\S]*?listing: ListingSource/,
      'the mint does not take the listing the folder walk produced',
    );
    const main = sources.find(({ file }) => file === 'main.ts')?.text ?? '';
    assert.ok(!/\bhostRoom\b|pickFolder|folderPickerOf/.test(main), 'the page still reaches for a folder');
  });

  it('refuses the host action with the sentence that says where the relay runs', () => {
    const main = sources.find(({ file }) => file === 'main.ts')?.text ?? '';
    assert.match(
      main,
      /function attemptHost\(\): void \{\n\s*hostError\.textContent = HOST_RUNS_IN_A_CLIENT;/,
      'a call to host answers with something other than the sentence',
    );
    // The control itself is never revealed, and the click listener is what answers a call that
    // reaches it anyway.
    assert.match(main, /hostButton\.hidden = true/, 'the host action is still revealed');
    assert.match(
      main,
      /hostButton\.addEventListener\('click', \(\) => \{\n\s*void attemptHost\(\);/,
      'a press on the host action answers with nothing',
    );
  });
});
