/**
 * Live proof for the flow-review fixes, without a browser on this host.
 *
 * Drives the page's own binding with a fake editor against a real `selvaged`
 * and re-walks the three headline flows: (1) a go-to lands silently — the tree
 * row and the buffer name the file — while a follow re-land announces who and
 * where, (2) a granted-but-unpublished file reads unpublished after opening,
 * and one the room asks this window's host for is supplied from its working
 * copy although the window never opened it, (3) a cut socket raises the
 * reconnect sentence and the reseated room converges again. Duplicate names and
 * the join error copy ride along.
 *
 * The binding's transient sentences are read by text, the way the page reads
 * them: the notice kind is the binding's own vocabulary, and the page routes it
 * to the session note with its own sentence (`RECONNECTING_NOTE`), which is why
 * the drop is asserted as the kind this binding raises *and* as the page's own
 * mapping of that kind.
 *
 * Usage: SELVAGE_BASE=wss://<server> node scripts/prove-flow2.mjs
 * (the default is the public demo, wss://selvage-demo.dontblameme.dev)
 */

import { readFileSync } from 'node:fs';

import { SessionBridge, applyChange } from '../src/bridge/index.ts';
import { PeerEngine } from '../src/bridge/index.ts';
import { listingSource, pageEngine } from '../src/browser/relay.ts';
import { CLIENT_ID } from '../src/browser/client-id.ts';
import { MonacoBinding } from '../src/browser/editor.ts';
import { rosterLabel } from '../src/browser/names.ts';
import { describeJoinError } from '../src/browser/transport.ts';
import { nativeWebSocketFactory } from '../src/browser/transport.ts';
import { fetchAndSave, fetchStandMs } from '../src/browser/fetch-download.ts';

const BASE = process.env.SELVAGE_BASE ?? 'wss://selvage-demo.dontblameme.dev';
const NOTES = 'notes.md';
const MAIN = 'src/main.ts';
const TODO = 'todo.txt';
const SEED_NOTES = '# room notes\nline two\n';
const SEED_MAIN = 'const x = 1;\n';

globalThis.document = {
  createElement: () => ({ append: () => {}, remove: () => {} }),
  head: { appendChild: () => {} },
};

function makeModel(text, seen) {
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
    pushEditOperations: (_before, edits, _cursor) => {
      for (const edit of edits) {
        const at = (p) => {
          const ls = text.split('\n');
          let offset = 0;
          for (let i = 0; i < p.lineNumber - 1; i += 1) offset += ls[i].length + 1;
          return offset + p.column - 1;
        };
        const from = at({ lineNumber: edit.range.startLineNumber, column: edit.range.startColumn });
        const to = at({ lineNumber: edit.range.endLineNumber, column: edit.range.endColumn });
        text = text.slice(0, from) + edit.text + text.slice(to);
      }
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
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: function () {
      return this.selection ?? null;
    },
    selection: null,
    setModel: () => {},
    setPosition: function (position) {
      this.selection = {
        selectionStartLineNumber: position.lineNumber,
        selectionStartColumn: position.column,
        positionLineNumber: position.lineNumber,
        positionColumn: position.column,
      };
    },
    revealPositionInCenter: () => {},
  };
}

class MemHost {
  /** What this window has in front of it, which is not everything the folder holds. */
  texts = new Map();
  /** The folder this window shares: a path the room asks for is read from here. */
  disk = new Map();
  text(path) {
    return this.texts.get(path);
  }
  lineEnding(_path) {
    return '\n';
  }
  async applyChange(path, change) {
    const current = this.texts.get(path);
    if (current === undefined) return false;
    this.texts.set(path, applyChange(current, change));
    return true;
  }
  async save(_path) {
    return true;
  }
  async readGrantedFile(path) {
    const text = this.disk.get(path);
    return text === undefined ? { kind: 'refused', cause: 'missing' } : { kind: 'text', text };
  }
  renderCursors(_cursors) {}
  report(_report) {}
}

async function waitFor(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = predicate();
    if (seen !== undefined) return seen;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function check(name, condition) {
  if (!condition) throw new Error(`FAILED: ${name}`);
  console.log(`ok: ${name}`);
}

// `§7.1` seals the room state from the host's listing, so the tree is walked before the mint:
// todo.txt is listed but never opened or seeded, which is the unpublished case below, and
// shared/held.txt is listed and on the host's disk but never opened in its window, which is the
// case the room's own hold reaches. empty.txt is listed and on the host's disk holding nothing at
// all, which is the case an empty answer is the whole of.
const HELD = 'shared/held.txt';
const HELD_TEXT = 'the host’s own copy of it\n';
const EMPTY = 'empty.txt';
const listing = listingSource([NOTES, MAIN, TODO, HELD, EMPTY]);
const hostEngine = pageEngine(
  await PeerEngine.host({
    baseUrl: BASE,
    displayName: 'flow2-host',
    listing,
    client: 'web-prove-flow2/host',
  }),
);
const invite = hostEngine.inviteUrl();
if (invite === undefined) throw new Error('host minted no invite');
console.log(`room minted: ${hostEngine.session().roomId}`);

const hostFiles = new MemHost();
hostFiles.texts.set(NOTES, SEED_NOTES);
hostFiles.texts.set(MAIN, SEED_MAIN);
hostFiles.disk.set(NOTES, SEED_NOTES);
hostFiles.disk.set(MAIN, SEED_MAIN);
hostFiles.disk.set(HELD, HELD_TEXT);
hostFiles.disk.set(EMPTY, '');
const hostBridge = new SessionBridge({ engine: hostEngine, host: hostFiles });
hostBridge.documentOpened(NOTES);
hostBridge.documentOpened(MAIN);
hostEngine.setSelection(MAIN, { anchor: 0, head: 5 });

let guestSocket;
const capturingFactory = (url) => {
  guestSocket = nativeWebSocketFactory(url);
  return guestSocket;
};
const guestEngine = pageEngine(
  await PeerEngine.join({
    invite,
    displayName: 'flow2-guest',
    webSocketFactory: capturingFactory,
    client: CLIENT_ID,
  }),
);

const notices = [];
const editor = makeEditor();
/** The last model the binding put in front of the editor, which is where a guest's buffer is read. */
let frontedModel;
editor.setModel = (model) => {
  if (model !== undefined && model !== null) {
    frontedModel = model;
  }
};
const binding = new MonacoBinding({
  engine: guestEngine,
  editor,
  onNotice: (notice) => void notices.push(notice),
  createModel: (text, language) => makeModel(text, language),
});
const hostPeerId = hostEngine.session().peer.peer_id;
const sentences = () =>
  notices.filter((notice) => typeof notice.text === 'string').map((notice) => notice.text);

// (1) The go-to lands, and says nothing: the tree row and the buffer name the
// file, so no sentence is owed.
await waitFor(
  'host presence to cross',
  () => guestEngine.presence().find((record) => record.peer?.peer_id === hostPeerId)?.state?.selection,
  // The host's caret was published before this guest existed, and §8's renewal is what re-sends
  // it: the bound is one renewal period (`awareness_renew_ms` 15 000 here), not the transport's.
  30_000,
);
await binding.goTo(hostPeerId);
check('go-to landing agrees with the editor', binding.currentPath() === MAIN);
check(
  'go-to landing announces no file',
  !sentences().some((text) => text.startsWith('open:')),
);

// A follow re-land raises the indicator whose segment the file strip draws, and says no sentence:
// the strip carries who is followed and the buffer carries where, so a status line would be the
// same fact in a second place (the page's notice policy).
await binding.follow(hostPeerId);
check('the follow raises the indicator', binding.following()?.peerId === hostPeerId);
hostEngine.setSelection(NOTES, { anchor: 0, head: 3 });
await waitFor(
  'the follow re-land',
  () => (binding.currentPath() === NOTES ? true : undefined),
  10_000,
);
check('follow re-land agrees with the editor', binding.currentPath() === NOTES);
check(
  'a follow re-land says nothing in the status line',
  !sentences().some((text) => text.includes('Following')),
);
binding.stopFollowing();
check(
  'stopping the follow takes the indicator down',
  binding.following() === undefined,
);

// (2) Granted-but-unpublished opens empty and reads unpublished.
await binding.openDocument(TODO);
check('unpublished file opens empty', guestEngine.text(TODO) === '');
check('unpublished file reads unpublished', binding.isUnpublished(TODO) === true);
check('published file reads published', binding.isUnpublished(NOTES) === false);

// (2b) A path this window's host never opened, held by the guest: the hold is the ask, the host
// reads its working copy for it, and the guest's buffer is given what arrived. Nothing chooses
// the host's replica here — the host only ever looked at its own disk.
await binding.openDocument(HELD);
check('a listed path nobody has published opens empty', guestEngine.text(HELD) === '');
check('and reads unpublished', binding.isUnpublished(HELD) === true);
check('the empty buffer is the guest’s own', frontedModel.__text() === '');
await waitFor(
  'the host to publish its working copy',
  () => (guestEngine.text(HELD) === HELD_TEXT ? true : undefined),
  // The hold goes out with the state that commits this connection's key, and the host's own
  // read is one round trip behind it: the bound is a wire's, not the renewal clock's.
  20_000,
);
check('the guest is given the host’s copy', true);
await waitFor(
  'the guest’s buffer to hold it',
  () => (frontedModel.__text() === HELD_TEXT ? true : undefined),
  10_000,
);
check('the guest’s buffer holds the host’s copy', true);
check('and the path reads published once the text has arrived', binding.isUnpublished(HELD) === false);

// (2c) A file the host has and that is empty is answered, not waited out. The room sends the empty
// document — `has` is what an answer is, empty included, and the engine under `src/engine` is what
// publishes one — and the fetch reports that answer the moment it lands rather than standing for
// the whole window. Measured against a real `selvaged`, an answered ask took the whole stand
// (3 007 ms) while the answer itself had landed 101 ms in, with the row saying `Asking the host …`
// for all of it. The host never opens empty.txt, so what the guest receives is the host's own read
// of its working copy, which is the only path that can produce an empty answer at all.
const emptyStandMs = fetchStandMs(guestEngine.session().keepalive.awareness_renew_ms);
const standPolls = Math.trunc(emptyStandMs / 100);
const fetched = [];
let emptyPolls = 0;
let answeredPolls;
let answeredAt;
const askedAt = Date.now();
const fetchOutcome = await fetchAndSave(
  EMPTY,
  {
    // The answer is recorded where the fetch itself reads it, so the count is the fetch's own and not
    // a second reading beside it: an answer that arrives before the first wait lands on poll 0 and
    // the assertion below still holds.
    has: (path) => {
      const present = guestEngine.has(path);
      if (path === EMPTY && present && answeredPolls === undefined) {
        answeredPolls = emptyPolls;
        answeredAt = Date.now() - askedAt;
      }
      return present;
    },
    text: (path) => guestEngine.text(path),
    open: (path) => binding.requestText(path),
    save: (path, text) => void fetched.push([path, text]),
  },
  {
    standMs: emptyStandMs,
    wait: async (ms) => {
      emptyPolls += 1;
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
  },
);
check('the room answers an empty granted file with a document', guestEngine.has(EMPTY));
check('and the answer carries no text', guestEngine.text(EMPTY) === '');
check('the fetch reports that answer as the empty one', fetchOutcome.kind === 'empty');
check('and saves nothing that was not asked for', fetched.length === 0);
// The poll the answer landed on is the whole of what the loop may spend: this is what tells a fetch
// that stops at the answer from one that read on for text, and it is measured against the answer
// rather than against the stand, so a slow but valid answer — a hold that waits a renewal window
// out, a round trip with latency on it — cannot fail it. Waiting for text past the document costs
// the rest of the stand, which is where `emptyPolls` goes without the early exit.
check(
  `and stops at the answer, not at the stand (${String(emptyPolls)} of ${String(standPolls)} polls; the answer landed on poll ${String(answeredPolls ?? -1)}, ${String(answeredAt ?? -1)} ms in)`,
  answeredPolls !== undefined && emptyPolls === answeredPolls,
);

// Duplicate names disambiguate in the roster vocabulary: the twin takes the
// host's name, so the guest's peer list itself holds the clash.
const twin = pageEngine(
  await PeerEngine.join({ invite, displayName: 'flow2-host', client: 'web-prove-flow2/twin' }),
);
await waitFor('twin to appear', () => (binding.participants().length >= 2 ? true : undefined), 10_000);
const dupes = binding.participants().filter((p) => p.displayName === 'flow2-host');
check('duplicate name is present twice', dupes.length === 2);
const labels = new Set(binding.participants().map((p) => rosterLabel(p, binding.participants())));
check(
  'duplicate names render apart',
  labels.size === binding.participants().length,
);
await twin.disconnect();

// The unreachable-server copy, against the page's own mapping.
check(
  'raw socket error maps to plain copy',
  describeJoinError(new Error('the WebSocket reported an error'), `${BASE}/session`) ===
    "Couldn't reach the session. Check your connection and retry.",
);

// (3) Cut the socket: the reconnect sentence fires, the room reseats and
// converges.
let reconnecting = false;
const stop = guestEngine.on((event) => {
  if (event.type === 'reconnecting') reconnecting = true;
});
binding.stopFollowing();
await binding.openDocument(NOTES);
guestSocket.close();
await waitFor(
  'the drop to raise the reconnecting notice',
  () => (notices.some((notice) => notice.kind === 'reconnecting') ? true : undefined),
  10_000,
);
check('the drop raises the reconnecting notice', reconnecting);
// The sentence is the page's, not the binding's: the notice kind carries none, and `main.ts`
// shows `RECONNECTING_NOTE` for it. The mapping is read from the page's own source, because a
// page with no DOM cannot be driven here.
check(
  'the page shows the reconnecting sentence for that notice',
  /case 'reconnecting':[\s\S]{0,200}sessionNote\.dropped\(RECONNECTING_NOTE\)/.test(
    readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8'),
  ),
);
const afterReconnect = `${guestEngine.text(NOTES)}back again\n`;
hostFiles.texts.set(NOTES, afterReconnect);
hostBridge.documentChanged(NOTES);
await waitFor(
  'room to converge after reconnect',
  () => (guestEngine.text(NOTES) === afterReconnect ? true : undefined),
  // A re-seat re-announces this connection's holds on the renewal clock (`§13.7` renews the whole
  // set) and the host publishes the state that names them on its own, so a cut socket's room can
  // take up to two renewal periods to converge: 27.7 s measured against a server whose
  // `awareness_renew_ms` is 15 000 (see `prove-m1.mjs`).
  45_000,
);
check('room converges after reconnect', true);
stop();

binding.dispose();
await guestEngine.disconnect();
await hostEngine.disconnect();
console.log('PROOF OK');
