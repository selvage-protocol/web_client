/**
 * Live proof for the M1 page stack, without a browser on this host.
 *
 * Drives the page's own code — the synced engine copy, the native WebSocket
 * factory, the session bridge, and the real `MonacoBinding` with a fake editor
 * standing in for Monaco — against a real `selvaged`: the room is minted by this
 * checkout's own engine, the guest joins the way the page does (with the default
 * `/meta` check, no skip), and the proof walks the roster, the grant tree, a
 * jump, a follow, convergence both ways, a reconnect, and the degraded `/meta`
 * a cross-origin page sees. What is not covered here is Monaco itself; the
 * adapter owns no protocol logic beyond offset mapping, which both sides count
 * in UTF-16 code units.
 *
 * Usage: SELVAGE_BASE=wss://<server> node scripts/prove-m1.mjs
 * (the default is the public demo, wss://selvage-demo.dontblameme.dev)
 */

import { applyChange, SessionBridge } from '../src/bridge/index.ts';
import { FolderWorkingCopy } from '../src/browser/folder.ts';
import { createInFolder } from '../src/browser/new-entry.ts';
import { peerColour } from '../src/bridge/index.ts';
import { PeerEngine } from '../src/bridge/index.ts';
import { listingSource, pageEngine } from '../src/browser/relay.ts';
import { CLIENT_ID } from '../src/browser/client-id.ts';
import { MonacoBinding } from '../src/browser/editor.ts';
import { languageForPath } from '../src/browser/languages.ts';
import { nativeWebSocketFactory } from '../src/browser/transport.ts';

const BASE = process.env.SELVAGE_BASE ?? 'wss://selvage-demo.dontblameme.dev';
const NOTES = 'notes.md';
const MAIN = 'src/main.ts';
const SEED_NOTES = '# room notes\nline two\n';
const SEED_MAIN = 'const x = 1;\n';

// Minimal DOM: the binding owns one <style> element for peer colours.
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

function makeEditor(seen) {
  return {
    positions: [],
    createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: function () {
      return this.selection ?? null;
    },
    selection: null,
    setModel: () => {},
    setPosition: function (position) {
      this.positions.push(position);
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
  texts = new Map();
  cursors = [];
  reports = [];
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
  async readGrantedFile(_path) {
    return undefined;
  }
  renderCursors(cursors) {
    this.cursors = cursors;
  }
  report(report) {
    this.reports.push(report);
  }
}

/**
 * The folder a browser host is handed, in memory: the four methods `FolderWorkingCopy` calls, so
 * the page's own layer decides what may be created and walks the path the way it does in a browser.
 */
function newFolderHandle() {
  let stamps = 0;
  const node = () => ({ kind: 'directory', children: new Map() });
  const root = node();
  const fileOf = (entry) => ({
    kind: 'file',
    name: entry.name,
    async getFile() {
      return {
        lastModified: entry.lastModified,
        size: new TextEncoder().encode(entry.text).length,
        arrayBuffer: async () => new TextEncoder().encode(entry.text).buffer,
      };
    },
    async createWritable() {
      let pending = '';
      return {
        async write(data) {
          pending += data;
        },
        async close() {
          entry.text = pending;
          entry.lastModified += 1;
        },
      };
    },
  });
  const handleOf = (dir) => ({
    kind: 'directory',
    name: 'project',
    async *values() {
      for (const [name, child] of dir.children) {
        yield { name, kind: child.kind };
      }
    },
    async getDirectoryHandle(name, options) {
      let child = dir.children.get(name);
      if (child === undefined) {
        if (options?.create !== true) throw new DOMException('NotFoundError', 'NotFoundError');
        child = node();
        dir.children.set(name, child);
      }
      if (child.kind !== 'directory') throw new DOMException('TypeMismatchError', 'TypeMismatchError');
      return handleOf(child);
    },
    async getFileHandle(name, options) {
      let child = dir.children.get(name);
      if (child === undefined) {
        if (options?.create !== true) throw new DOMException('NotFoundError', 'NotFoundError');
        stamps += 1;
        child = { kind: 'file', name, text: '', lastModified: stamps };
        dir.children.set(name, child);
      }
      if (child.kind !== 'file') throw new DOMException('TypeMismatchError', 'TypeMismatchError');
      return fileOf(child);
    },
  });
  return handleOf(root);
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

// The room is minted by this checkout's own engine: one copy, no harness caveat. `§7.1` seals the
// room state from the host's listing, so the tree is walked before the mint, as the page does.
const hostListing = listingSource([NOTES, MAIN, 'todo.txt']);
const hostEngine = pageEngine(
  await PeerEngine.host({
    baseUrl: BASE,
    displayName: 'prove-host',
    listing: hostListing,
    client: 'web-prove/host',
  }),
);
const invite = hostEngine.inviteUrl();
if (invite === undefined) throw new Error('host minted no invite');
console.log(`room minted: ${hostEngine.session().roomId}`);

const hostFiles = new MemHost();
hostFiles.texts.set(NOTES, SEED_NOTES);
hostFiles.texts.set(MAIN, SEED_MAIN);
const hostBridge = new SessionBridge({ engine: hostEngine, host: hostFiles });
hostBridge.documentOpened(NOTES);
hostBridge.documentOpened(MAIN);
console.log('host shares two documents and a three-path listing');

// The page joins with the default `/meta` check — no skip — and the handshake
// speaks the one wire version on top.
let guestSocket;
const capturingFactory = (url) => {
  guestSocket = nativeWebSocketFactory(url);
  return guestSocket;
};
const guestEngine = pageEngine(
  await PeerEngine.join({
    invite,
    displayName: 'prove-web',
    webSocketFactory: capturingFactory,
    client: CLIENT_ID,
  }),
);
console.log(`guest joined as ${guestEngine.session().role} over native WebSocket, meta checked`);

const seen = { languages: [] };
const guestEditor = makeEditor(seen);
const notices = [];
const guestModels = [];
const binding = new MonacoBinding({
  engine: guestEngine,
  editor: guestEditor,
  onNotice: (notice) => void notices.push(notice),
  createModel: (text, language) => {
    seen.languages.push(language);
    const model = makeModel(text, seen);
    guestModels.push(model);
    return model;
  },
});
guestEngine.setSelection(NOTES, { anchor: 0, head: 0 });

// The roster names the host with the caret mapping's colour.
const roster = await waitFor(
  'roster to name the host',
  () => {
    const participants = binding.participants();
    return participants.length > 0 ? participants : undefined;
  },
  10_000,
);
const hostRow = roster.find((row) => row.displayName === 'prove-host');
check('roster names the host', hostRow !== undefined);
check('roster colour reuses the caret mapping', hostRow.colour === peerColour(hostRow.peerId));
console.log(`roster: ${roster.map((row) => `${row.displayName}@${row.path ?? '—'}`).join(', ')}`);
// The role each side is seated with (`§13.4`), which the roster draws as its own marker and the
// room's peer list never carries for this connection: the page reads its own seat's role from the
// session. Printed because it is the one fact a browser cannot be asked for here.
console.log(
  `roles: host=${hostEngine.session().role}, guest=${guestEngine.session().role}, peers=${JSON.stringify(
    hostEngine.peers().map((peer) => `${peer.display_name}:${peer.role}`),
  )}`,
);

// Renaming yourself (`PROTOCOL.md` §5), through the page's own wrapper and over the wire. The
// room relabels the seat for everyone else, and it announces the same change to the connection
// that asked (§5: to every peer in the room, the one that renamed included), so both sides are
// read here — the mover's own name is what a re-hello after a drop carries (§9.1). The page keeps
// a copy of the name itself because the request returns before that event (§5 puts the response
// first), not because the room withholds it.
await guestEngine.rename('prove-web-renamed');
const renamed = await waitFor(
  'the room to relabel the guest for the host',
  () => hostEngine.peers().find((peer) => peer.display_name === 'prove-web-renamed'),
  10_000,
);
check('the room reports the renamed seat to the other side', renamed.peer_id !== '');
check(
  'and no longer names that seat the old way',
  hostEngine.peers().every((peer) => peer.display_name !== 'prove-web'),
);
const selfRenamed = await waitFor(
  'the renaming connection to hold the new name',
  () =>
    guestEngine.session().peer.display_name === 'prove-web-renamed'
      ? guestEngine.session().peer
      : undefined,
  10_000,
);
check('the renaming connection holds the name the room has', selfRenamed.display_name === 'prove-web-renamed');

// The grant tree unions the listing with the open documents, directories first.
const listing = await waitFor(
  'grant listing to arrive',
  () => (binding.grantListing().length >= 3 ? binding.grantListing() : undefined),
  10_000,
);
check('grant listing unions listing and open documents', listing.includes('todo.txt') && listing.includes(NOTES));
const root = binding.grantTree('');
check('grant tree synthesises directories first', root[0]?.directory === true && root[0]?.name === 'src');
console.log(`tree: ${listing.join(', ')}`);

// Clicking a listed path opens it and fetches the text, like the desktop guest.
await binding.openDocument(MAIN);
await waitFor(
  'listed document to fetch',
  () => (guestEngine.text(MAIN) === SEED_MAIN ? true : undefined),
  10_000,
);
check('click opens and fetches the listed document', true);
check('models take the backed language', seen.languages.includes(languageForPath(MAIN)));
check('markdown maps too', languageForPath(NOTES) === 'markdown');

// Jump to the host: lands in the host's document at the host's caret.
hostEngine.setSelection(MAIN, { anchor: 0, head: 5 });
const hostPeerId = hostEngine.session().peer.peer_id;
await waitFor(
  'host presence to cross',
  () => guestEngine.presence().find((record) => record.peer?.peer_id === hostPeerId)?.state?.selection,
  10_000,
);
await binding.goTo(hostPeerId);
check('jump lands in the followed document', binding.currentPath() === MAIN);
// The landing may arrive via the pending go-to's next frame when a room event
// supersedes the first attempt mid-open; the page shows the landing either way.
const jumped = await waitFor(
  'jump to place the caret',
  () => guestEditor.positions.at(-1),
  10_000,
);
check('jump places the caret', jumped !== undefined);
console.log(`jump: ${MAIN} at line ${jumped.lineNumber}, column ${jumped.column}`);

// Follow: the indicator rises, and the next caret move re-lands.
await binding.follow(hostPeerId);
check('follow indicator is up', binding.following()?.peerId === hostPeerId);
const at = guestEditor.positions.length;
hostEngine.setSelection(MAIN, { anchor: 0, head: 11 });
await waitFor(
  'follow to re-land on the next frame',
  () => (guestEditor.positions.length > at ? true : undefined),
  10_000,
);
check('follow re-lands on a remote caret move', true);

// The binding's open primitive does not end the follow — landings are opens,
// so this programmatic switch keeps it; only editing, leaving, or stopping
// does. On the page, opening a file from the tree is a deliberate navigation
// and stops the follow first, the same class as going to someone.
await binding.openDocument(NOTES);
await waitFor(
  'guest to hold the notes seed',
  () => (guestEngine.text(NOTES) === SEED_NOTES ? true : undefined),
  10_000,
);
check('follow survives switching documents', binding.following()?.peerId === hostPeerId);

// A local edit ends the follow, and the keystroke still reaches the room. The
// keystroke goes into the front document: that is what typing while following is.
await binding.openDocument(MAIN);
check('guest is where the follow put it', binding.currentPath() === MAIN);
const mainModel = guestModels[0];
if (mainModel === undefined) throw new Error('guest never built the main model');
mainModel.pushEditOperations([], [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: '// guest\n', forceMoveMarkers: true }], () => null);
mainModel.__fire();
check('a local edit ends the follow', binding.following() === undefined);
check('the stop is announced', notices.some((notice) => notice.kind === 'follow' && notice.following === undefined));
await waitFor(
  'host to converge on the guest edit',
  () => (hostEngine.text(MAIN).includes('// guest') ? true : undefined),
  10_000,
);
check('guest edit converges on the host', true);

// Convergence the other way, through the binding, guest as the page's buffer.
const withGuestLine = hostEngine.text(MAIN);
hostFiles.texts.set(MAIN, `${withGuestLine}host line\n`);
hostBridge.documentChanged(MAIN);
await waitFor(
  'guest to converge on the host edit',
  () => (guestEngine.text(MAIN) === `${withGuestLine}host line\n` ? true : undefined),
  10_000,
);
check('host edit converges on the guest', true);

// The degraded `/meta` a cross-origin page sees: the read fails like any
// unreachable endpoint, advisory, never a refusal — the join still lands.
const degraded = pageEngine(
  await PeerEngine.join({
    invite,
    displayName: 'prove-degraded',
    webSocketFactory: nativeWebSocketFactory,
    fetchImpl: () => Promise.reject(new Error('CORS blocked')),
    client: CLIENT_ID,
  }),
);
check('join survives an unreadable /meta', degraded.session().role === 'guest');
await degraded.disconnect();

// Reconnect: cut the socket, watch it come back, converge again.
let reconnecting = false;
const stop = guestEngine.on((event) => {
  if (event.type === 'reconnecting') reconnecting = true;
});
guestSocket.close();
await waitFor('engine to notice the cut socket', () => (reconnecting ? true : undefined), 10_000);
console.log('guest reconnects after the socket is cut');
const afterReconnect = `${guestEngine.text(NOTES)}back again\n`;
hostFiles.texts.set(NOTES, afterReconnect);
hostBridge.documentChanged(NOTES);
await waitFor(
  'room to converge after reconnect',
  () => (guestEngine.text(NOTES) === afterReconnect ? true : undefined),
  // A re-seat re-announces this connection's holds on the renewal clock (`§13.7` renews the whole
  // set) and the host publishes the state that names them on its own, so a cut socket's room can
  // take up to two renewal periods to converge: 27.7 s measured here against a server whose
  // `awareness_renew_ms` is 15 000.
  45_000,
);
stop();
check('room converges after reconnect', true);

binding.dispose();
await guestEngine.disconnect();
await hostEngine.disconnect();

// A room whose folder held nothing, and the first file put into it. This is the page's own create
// (`createInFolder`): the folder layer makes the file and stamps it, the walk that follows is what
// the room is told, and the created file is opened — which is what makes its text reach the room at
// all, since content arrives when a file is opened. The folder is a double because the picker's
// dialog is the one thing no driver here can answer, and the guest below is a real second client.
const createListing = listingSource([]);
const createHost = pageEngine(
  await PeerEngine.host({
    baseUrl: BASE,
    displayName: 'create-host',
    listing: createListing,
    client: 'web-prove/create-host',
  }),
);
const createInvite = createHost.inviteUrl();
if (createInvite === undefined) throw new Error('the create host minted no invite');
console.log(`empty room minted: ${createHost.session().roomId}`);
const createFiles = new MemHost();
const createFilesBridge = new SessionBridge({ engine: createHost, host: createFiles });
const createdFolder = new FolderWorkingCopy(newFolderHandle());

const watching = pageEngine(
  await PeerEngine.join({
    invite: createInvite,
    displayName: 'create-guest',
    webSocketFactory: nativeWebSocketFactory,
    client: CLIENT_ID,
  }),
);
await waitFor(
  'the guest to be seated in a room that lists nothing',
  () => (watching.session().role === 'guest' && watching.grantedPaths().length === 0 ? true : undefined),
  10_000,
);
check('the guest is in an empty room', true);

const CREATED = 'notes.md';
const outcome = await createInFolder(
  {
    folder: createdFolder,
    publish: async (paths) => {
      createListing.replace(paths);
      await createHost.grant(paths);
    },
    open: async (path) => {
      // The host's own read of the file it just made: empty, and the seed the room receives.
      createFiles.texts.set(path, '');
      createFilesBridge.documentOpened(path);
    },
  },
  CREATED,
  'file',
);
check('the page created the file in the folder it holds', outcome.kind === 'created');
const listed = await waitFor(
  'the guest to receive the created path',
  () => (watching.grantedPaths().includes(CREATED) ? true : undefined),
  10_000,
);
check('the guest sees the path the host created', listed === true);
console.log(`guest listing: ${watching.grantedPaths().join(', ')}`);

// The host types into the file it just made: the room's text reaches the guest, which is what the
// page's own open is for.
const CREATE_TEXT = '# typed into the file the page created\n';
createFiles.texts.set(CREATED, CREATE_TEXT);
createFilesBridge.documentChanged(CREATED);
await waitFor(
  'the guest to receive the created file\'s text',
  () => (watching.text(CREATED) === CREATE_TEXT ? true : undefined),
  10_000,
);
check('the created file\'s text reaches the guest', true);

await watching.disconnect();
await createHost.disconnect();
console.log('PROOF OK');
