/**
 * Live proof for the owner-feedback pass, without a browser on this host.
 *
 * Drives the page's own code — the synced engine copy, the native WebSocket
 * factory, and the real `MonacoBinding` with a fake editor — against a real
 * `selvaged`: open-via-tree (the only open affordance left), create+move tree
 * refresh on listing changes, and the page-origin share-link shape with a
 * round-trip back into a join. What is not covered here is Monaco itself.
 *
 * Usage: SELVAGE_BASE=wss://<server> node scripts/prove-fb2.mjs
 * (the default is the public demo, wss://selvage-demo.dontblameme.dev)
 */

import { applyChange, SessionBridge } from '../src/bridge/index.ts';
import { PeerEngine } from '../src/bridge/index.ts';
import { listingSource, pageEngine } from '../src/browser/relay.ts';
import { fragmentOf } from '../src/browser/join.ts';
import { CLIENT_ID } from '../src/browser/client-id.ts';
import { MonacoBinding } from '../src/browser/editor.ts';
import { languageForPath } from '../src/browser/languages.ts';
import { buildShareLink, parsePageLink } from '../src/browser/share.ts';
import { pageOriginOf, serverBaseOf } from '../src/browser/servers.ts';
import { nativeWebSocketFactory } from '../src/browser/transport.ts';

const BASE = process.env.SELVAGE_BASE ?? 'wss://selvage-demo.dontblameme.dev';
const NOTES = 'notes.md';
const MAIN = 'src/main.ts';
const MOVED = 'docs/notes.md';
const SEED_NOTES = '# room notes\nline two\n';
const SEED_MAIN = 'const x = 1;\n';

// Minimal DOM: the binding owns one <style> element for peer colours.
globalThis.document = {
  createElement: () => ({ append: () => {}, remove: () => {} }),
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
      void listener;
      return { dispose: () => {} };
    },
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

class MemHost {
  texts = new Map();
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

// `§7.1` seals the room state from the host's listing, so the tree is walked before the mint.
const listing = listingSource([NOTES, MAIN]);
const hostEngine = pageEngine(
  await PeerEngine.host({
    baseUrl: BASE,
    displayName: 'prove-fb2-host',
    listing,
    client: 'web-prove-fb2/host',
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
console.log('host shares notes.md and src/main.ts');

const guestEngine = pageEngine(
  await PeerEngine.join({
    invite,
    displayName: 'prove-fb2-web',
    webSocketFactory: nativeWebSocketFactory,
    client: CLIENT_ID,
  }),
);
console.log('guest joined the way the page does');

const seen = { languages: [] };
const notices = [];
const binding = new MonacoBinding({
  engine: guestEngine,
  editor: makeEditor(),
  onNotice: (notice) => void notices.push(notice),
  createModel: (text, language) => {
    seen.languages.push(language);
    return makeModel(text);
  },
});

// Open-via-tree: the only open affordance left. The tree names the file; the
// guest opens what the tree names and fetches the text.
await waitFor('grant listing to arrive', () => (binding.grantListing().length >= 2 ? true : undefined), 10_000);
const rootNames = binding.grantTree('').map((child) => [child.name, child.directory]);
console.log(`tree root: ${JSON.stringify(rootNames)}`);
check('tree synthesises src first', rootNames[0]?.[0] === 'src' && rootNames[0]?.[1] === true);
const viaTree = binding.grantTree('src').find((child) => child.name === 'main.ts');
check('tree names src/main.ts', viaTree !== undefined && viaTree.directory === false);
await binding.openDocument(viaTree.path);
await waitFor('tree-opened document to fetch', () => (guestEngine.text(MAIN) === SEED_MAIN ? true : undefined), 10_000);
check('open-via-tree fetches the listed document', true);
check('tree-opened model takes the backed language', seen.languages.includes(languageForPath(MAIN)));

// Create+move refresh: the host creates a folder and moves the entry into it.
// The guest tree re-renders on the listing changes — no stale rows.
notices.length = 0;
hostFiles.texts.set(MOVED, `${SEED_NOTES}moved into docs\n`);
hostBridge.documentOpened(MOVED);
hostBridge.documentClosed(NOTES);
await hostEngine.grant([MAIN, MOVED]);
console.log('host moved notes.md into docs/');
await waitFor(
  'guest tree to show the move',
  () => {
    const listing = binding.grantListing();
    if (!listing.includes(MOVED) || listing.includes(NOTES)) return undefined;
    const root = binding.grantTree('');
    if (!root.some((child) => child.directory && child.name === 'docs')) return undefined;
    return true;
  },
  10_000,
);
check('create+move refreshes the tree', true);
check(
  'listing changes announced the refreshed tree',
  notices.some((notice) => notice.kind === 'grant' && notice.paths.includes(MOVED)),
);
check('moved entry opens from the new path', (await binding.openDocument(MOVED), guestEngine.text(MOVED).includes('moved into docs')));

// Share-link shape: the room's own page link — never a bare ws:// — carrying
// a join that lands back in the room.
const inviteUrl = new URL(invite);
const room = inviteUrl.searchParams.get('room');
const token = inviteUrl.searchParams.get('token');
if (room === null || token === null) throw new Error('invite names no room');
const share = buildShareLink(BASE, room, token, fragmentOf(invite));
console.log(`share: ${share}`);
check('share link is the room\'s own page', share.startsWith(`${pageOriginOf(BASE)}/?`));
check('share link names no ws://', !share.includes('ws://'));
const back = parsePageLink(share);
check('share link round-trips into room and token', back?.room === room && back?.token === token);
check('share link reads back as the room\'s own server', serverBaseOf(back.origin) === BASE);
// The link is the whole invite, `§5.1`'s fragment included: a page link without the two keys is a
// join the engine refuses where it reads it, so the round trip has to carry them.
check('share link carries the invite\'s own fragment', back?.fragment === fragmentOf(invite));
const rejoin = pageEngine(
  await PeerEngine.join({
    invite: share,
    displayName: 'prove-fb2-rejoin',
    webSocketFactory: nativeWebSocketFactory,
    client: CLIENT_ID,
  }),
);
check('share link round-trips back into a join', rejoin.session().role === 'guest');
await rejoin.disconnect();

binding.dispose();
await guestEngine.disconnect();
await hostEngine.disconnect();
console.log('PROOF OK');
