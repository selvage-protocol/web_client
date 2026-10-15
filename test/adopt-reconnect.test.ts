/**
 * The browser adapter over a room whose role is still resolving.
 *
 * The vendor sync brought in the engine's §13.1 window: a local edit made before the applied
 * state commits this connection's key is held apart, a state that seats the key as `viewer`
 * adopts the clean replica the edit was held apart from, and a state that seats it as a writer
 * keeps the edit. The page keeps the whole stack in one process — the adapter
 * (`MonacoBinding`), the bridge (`SessionBridge`), the facade (`PeerEngine`) and the engine
 * (`PeerSession` over `RelaySession`) — so this file composes the real ones and drives §13.1's
 * window by hand.
 *
 * Only the socket and the server vocabulary are faked (`test/support/fake-room.ts`), because a
 * real `selvaged` is the other repository's build; no engine is stubbed.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding } from '../src/browser/editor.ts';
import { pageEngine } from '../src/browser/relay.ts';
import { PeerEngine } from '../src/bridge/index.ts';
import { RelaySession } from '../src/engine/relay.ts';
import { parseEnvelope } from '../src/engine/sealed.ts';
import { FAKE_BASE, FakeRoom } from './support/fake-room.ts';

const PATH = 'notes.txt';
const OTHER = 'src/main.rs';

/** The room's clocks, slow enough that §7.1's publish window does not fold the two states. */
const KEEPALIVE = { ping_interval_ms: 30_000, awareness_renew_ms: 30_000, awareness_expire_ms: 90_000 };

const isState = (bytes) => parseEnvelope(bytes)?.kind === 1;
const isContent = (bytes) => parseEnvelope(bytes)?.kind === 0;

/** A Monaco text model: offsets are UTF-16 code units, which is what both sides count. */
function makeModel(initial) {
  let text = initial;
  let disposed = false;
  const listeners = new Set();
  const lines = () => text.split('\n');
  const offsetOf = (at) => {
    const ls = lines();
    let offset = 0;
    for (let line = 0; line < at.lineNumber - 1; line += 1) {
      offset += (ls[line]?.length ?? 0) + 1;
    }
    return offset + at.column - 1;
  };
  const pointOf = (offset) => {
    const ls = lines();
    let rest = offset;
    for (let line = 0; line < ls.length; line += 1) {
      const length = ls[line]?.length ?? 0;
      if (rest <= length) {
        return { lineNumber: line + 1, column: rest + 1 };
      }
      rest -= length + 1;
    }
    const last = ls.length;
    return { lineNumber: last, column: (ls[last - 1]?.length ?? 0) + 1 };
  };
  return {
    isDisposed: () => disposed,
    dispose: () => {
      disposed = true;
    },
    getValue: () => text,
    getEOL: () => (text.includes('\r\n') ? '\r\n' : '\n'),
    getOffsetAt: offsetOf,
    getPositionAt: pointOf,
    pushEditOperations: (_before, edits) => {
      for (const edit of edits) {
        const from = offsetOf({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn });
        const to = offsetOf({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn });
        text = text.slice(0, from) + edit.text + text.slice(to);
      }
      return null;
    },
    onDidChangeContent: (listener) => {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    /** The person typed: the buffer changes and the editor raises its content event. */
    type: (next) => {
      text = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    current: () => text,
  };
}

/** A stand-in for Monaco that records the two things the adapter decides about it. */
function makeEditor() {
  return {
    decorations: [],
    readOnly: false,
    optionUpdates: 0,
    updateOptions(next) {
      this.readOnly = next.readOnly;
      this.optionUpdates += 1;
    },
    createDecorationsCollection() {
      return {
        set: (next) => void (this.decorations = next),
        clear: () => void (this.decorations = []),
      };
    },
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: () => {},
    focus: () => {},
    getOption: () => ({ verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }),
  };
}

function installDom() {
  globalThis.document = {
    createElement: () => ({ append: () => {}, remove: () => {} }),
    head: { appendChild: () => {} },
  };
}

/** Bounded polling of a real predicate, reporting what it waited on at the deadline. */
async function until(what, predicate, { timeoutMs = 4000, observed } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() >= deadline) {
      const seen = observed === undefined ? '' : ` — observed ${observed()}`;
      throw new Error(`timed out waiting for ${what}${seen}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const bindings = [];
const sessions = [];

after(() => {
  for (const binding of bindings) {
    binding.dispose();
  }
  for (const session of sessions) {
    session.disconnect();
  }
});

/** A host and a held joiner that declared `role`, over the fake room. */
async function pair(role) {
  installDom();
  const room = new FakeRoom({ holdBinary: ['joiner'], keepalive: KEEPALIVE });
  const host = await RelaySession.host({
    baseUrl: FAKE_BASE,
    displayName: 'host',
    listing: () => [PATH, OTHER],
    keepalive: KEEPALIVE,
    webSocketFactory: room.factory,
  });
  sessions.push(host);
  const invite = host.invite();
  assert.ok(invite !== undefined, 'the host minted no invite');
  const guest = await RelaySession.join({
    invite,
    displayName: 'joiner',
    declaredRole: role,
    reconnect: false,
    keepalive: KEEPALIVE,
    webSocketFactory: room.factory,
  });
  sessions.push(guest);
  return { room, host, guest };
}

/** Hands the joiner `count` of the held frames of one kind, oldest first. */
function deliver(room, kind, count = Number.MAX_SAFE_INTEGER) {
  let handed = 0;
  for (let index = 0; index < room.pendingBinary('joiner').length && handed < count; ) {
    const bytes = room.pendingBinary('joiner')[index];
    if (((kind === 'state') === isState(bytes))) {
      room.deliverBinary('joiner', index);
      handed += 1;
    } else {
      index += 1;
    }
  }
  return handed;
}

/** The state frames the room is holding for the joiner, oldest first. */
function heldStates(room) {
  return room.pendingBinary('joiner').filter(isState);
}

/** The composed page stack over a held joiner, with its models captured as they are built. */
function compose(guest) {
  const engine = pageEngine(new PeerEngine({ relay: guest, displayName: 'joiner' }));
  const editor = makeEditor();
  const notices = [];
  const models = new Map();
  let built;
  const binding = new MonacoBinding({
    engine,
    editor,
    onNotice: (notice) => void notices.push(notice),
    createModel: (text) => {
      built = makeModel(text);
      return built;
    },
  });
  bindings.push(binding);
  const changed = [];
  let peerReports = 0;
  engine.on((event) => {
    if (event.type === 'documentChanged') {
      changed.push(event.path);
    }
    if (event.type === 'peersChanged') {
      peerReports += 1;
    }
  });
  return {
    engine,
    editor,
    notices,
    changed,
    models,
    binding,
    takeBuilt: (path) => {
      models.set(path, built);
      built = undefined;
    },
    peerReports: () => peerReports,
  };
}

describe('a browser tab in §13.1’s window', () => {
  it('drops a viewer’s speculative text, reconciles the buffers and says the role once', async () => {
    const { room, host, guest } = await pair('viewer');
    // The host’s first state arrives before the joiner’s key is committed. Only that one is
    // handed in, so the window stays open until the test says otherwise. The second state —
    // the one its announcement makes the host mint, which is what commits the key — is waited
    // for here too, so the frame this test hands in is the uncommitted one and the committing
    // one is queued whenever the test asks for it.
    await until(
      'the uncommitted and committing states are queued',
      () => heldStates(room).length >= 2,
      { observed: () => `held states=${heldStates(room).length}` },
    );
    deliver(room, 'state', 1);
    await until('the joiner holds the listing', () => guest.listing().includes(PATH));
    assert.equal(guest.appliedRole(), undefined, 'no state has committed the joiner’s key yet');

    const page = compose(guest);
    await page.binding.openDocument(PATH);
    page.takeBuilt(PATH);
    assert.equal(page.editor.readOnly, false, 'an unresolved tab is editable until the state says otherwise');

    // The person types before the state that seats this tab, so both buffers carry text the
    // room has not committed this connection’s key to carry. The binding routes a keystroke
    // only for the model the editor holds in front, so the second document is opened — and
    // typed in — while the first document’s edit is still speculative.
    page.models.get(PATH).type('spec');
    await until('the first speculative insert reached the replica', () => guest.text(PATH) === 'spec', {
      observed: () => `text(${PATH})=${JSON.stringify(guest.text(PATH))}`,
    });
    await page.binding.openDocument(OTHER);
    page.takeBuilt(OTHER);
    page.models.get(OTHER).type('removed');
    await until(
      'the speculative text reached the replica in both documents',
      () => guest.text(PATH) === 'spec' && guest.text(OTHER) === 'removed',
      {
        observed: () =>
          `text(${PATH})=${JSON.stringify(guest.text(PATH))} text(${OTHER})=${JSON.stringify(guest.text(OTHER))}`,
      },
    );
    guest.setSelection(OTHER, { anchor: 3, head: 3 });

    await host.insert(PATH, 0, 'remote');
    await until('the remote content is queued', () => room.pendingBinary('joiner').some(isContent));
    deliver(room, 'content');
    await until('the joiner accepts the room history while unresolved', () => guest.text(PATH).includes('remote'));
    // The content scan compares the paths the local speculative edits touched (both of them), so
    // wait for its own report before taking the boundary below. The scan is one synchronous pass,
    // so once it is seen no content-phase `documentChanged` can still arrive and pass for the
    // resolution's own.
    await until(
      'the content phase reported both roots',
      () => page.changed.includes(PATH) && page.changed.includes(OTHER),
      { observed: () => `changed=${JSON.stringify(page.changed)}` },
    );
    const reportedBeforeState = page.changed.length;

    const seatsBefore = JSON.stringify(page.engine.peers());
    deliver(room, 'state');
    await until('the viewer role is applied', () => guest.appliedRole() === 'viewer');

    // The clean replica the speculation was held apart from is what the tab now shows, and the
    // remote history that arrived during the window is kept.
    assert.equal(guest.text(PATH), 'remote', 'the speculative insert was dropped with the clean replica');
    assert.equal(guest.text(OTHER), '', 'the speculative insert in the other document was dropped');

    // Only the resolution's own scan may report from here on, so both roots have to appear after
    // the boundary the committing state was delivered across.
    await until(
      'the state resolution reported both roots',
      () => {
        const reported = page.changed.slice(reportedBeforeState);
        return reported.includes(PATH) && reported.includes(OTHER);
      },
      { observed: () => `changed after state=${JSON.stringify(page.changed.slice(reportedBeforeState))}` },
    );
    await until('the buffers reconciled', () => page.binding.text(PATH) === 'remote' && page.binding.text(OTHER) === '');
    await until('the role change was reported', () => page.peerReports() > 0);

    assert.equal(page.editor.readOnly, true, 'a viewer’s document is read-only');
    assert.equal(
      page.notices.filter((notice) => notice.topic === 'role').length,
      1,
      'the viewer sentence was said once',
    );
    // The role moved while the seat-role map did not, so the report above is the facade’s own
    // `peersChanged` on the state, which is what the adapter re-reads the role from.
    assert.equal(
      JSON.stringify(page.engine.peers()),
      seatsBefore,
      'the seat-role map moved with the resolution, so the report is not the role’s own',
    );

    const local = guest.presence().find((record) => record.state?.path === OTHER);
    assert.equal(local?.state?.selection, undefined, 'a speculative selection must not retain dead anchors');

    // A viewer’s speculative structs are not in the room’s history: the clean publication the
    // host holds is the one the joiner now publishes from.
    await until(
      'the joiner’s clean publication matches the host’s',
      () => Buffer.from(guest.stateVector()).equals(Buffer.from(host.stateVector())),
    );
  });

  it('keeps a writer’s held-back history when the state seats it as a writer', async () => {
    const { room, host, guest } = await pair('guest');
    await until(
      'the uncommitted and committing states are queued',
      () => heldStates(room).length >= 2,
      { observed: () => `held states=${heldStates(room).length}` },
    );
    deliver(room, 'state', 1);
    await until('the joiner holds the listing', () => guest.listing().includes(PATH));
    assert.equal(guest.appliedRole(), undefined, 'no state has committed the joiner’s key yet');

    await guest.insert(PATH, 0, 'offline ');
    await until('the local edit is speculative in the replica', () => guest.text(PATH) === 'offline ');

    deliver(room, 'state');
    await until('the writer role is applied', () => guest.appliedRole() === 'guest');
    assert.equal(guest.text(PATH), 'offline ', 'a writer’s held-back edit was dropped');

    // The held-back edit is a writer’s and is published once the state commits the key.
    await until('the writer’s history reaches the room', () => host.text(PATH) === 'offline ');
    await until(
      'the two publication histories converge',
      () => Buffer.from(guest.stateVector()).equals(Buffer.from(host.stateVector())),
    );
  });
});
