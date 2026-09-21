/**
 * Live TLS proof: the page's own code over `wss://` + `https://` only.
 *
 * Hosts a room on a TLS origin and joins a guest through it, with the real
 * `/meta` check over https — the exact URLs an https page derives by the
 * scheme-match rule, against the demo origin unless another is named. Edits
 * converge both ways, and every derived URL is asserted TLS: an https page
 * must never emit a ws:// or http:// subrequest.
 *
 * Usage: SELVAGE_TLS_BASE=wss://selvage.dontblameme.dev node scripts/prove-tls.mjs
 */
import { applyChange, SessionBridge } from '../src/bridge/index.ts';
import { fetchMeta, SelvageEngine as Engine } from '../src/engine/index.ts';
import { metaUrl } from '../src/engine/index.ts';
import { MonacoBinding } from '../src/browser/editor.ts';
import { nativeWebSocketFactory } from '../src/browser/transport.ts';

/** Where the demo's page, `/meta` and `/session` are answered from, one origin. */
const DEMO_BASE = 'wss://selvage.dontblameme.dev';
const BASE = process.env.SELVAGE_TLS_BASE ?? DEMO_BASE;
const NOTES = 'notes.md';
const SEED = '# room notes\nline two\n';

globalThis.document = {
  createElement: () => ({ append: () => {}, remove: () => {} }),
  head: { appendChild: () => {} },
};

function makeModel(text) {
  const listeners = new Set();
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => text,
    getEOL: () => '\n',
    getOffsetAt: (pos) => pos.column - 1,
    getPositionAt: (offset) => ({ lineNumber: 1, column: offset + 1 }),
    pushEditOperations: (_before, edits, _cursor) => {
      for (const edit of edits) {
        text = text.slice(0, edit.range.startColumn - 1) + edit.text + text.slice(edit.range.endColumn - 1);
      }
      return null;
    },
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

// Every URL the page derives speaks TLS — the mixed-content invariant.
check('proof targets the TLS endpoint', BASE.startsWith('wss://'));
const meta = metaUrl(BASE);
check(`meta derives to https (${meta})`, meta.startsWith('https://'));

// The real `/meta` check over https: reachable and the wire version matches.
const metaDoc = await fetchMeta(BASE);
check('https /meta answers with selvage/1', (metaDoc.wire_versions ?? []).includes('selvage/1'));

// Host over wss, through the proxy to the same selvaged.
const hostEngine = await Engine.host(BASE, 'prove-tls-host', { client: 'web-prove-tls/host' });
const invite = hostEngine.inviteUrl();
if (invite === undefined) throw new Error('host minted no invite');
check(`invite is wss (${invite.slice(0, 8)}…)`, invite.startsWith('wss://'));
console.log(`room minted: ${hostEngine.session().roomId}`);

const hostFiles = new MemHost();
hostFiles.texts.set(NOTES, SEED);
const hostBridge = new SessionBridge({ engine: hostEngine, host: hostFiles });
hostBridge.documentOpened(NOTES);
await hostEngine.grant([NOTES]);

// Guest joins the way the page does: default `/meta` check, native socket.
const guestEngine = await Engine.join(invite, 'prove-tls-web', {
  webSocketFactory: nativeWebSocketFactory,
  client: 'web_client/0.1.0',
});
check('guest joins over wss', guestEngine.session().role === 'guest');

const guestModels = [];
const binding = new MonacoBinding({
  engine: guestEngine,
  editor: makeEditor(),
  onNotice: () => {},
  createModel: (text, language) => {
    const model = makeModel(text, language);
    guestModels.push(model);
    return model;
  },
});
await binding.openDocument(NOTES);
await waitFor('guest to hold the seed', () => (guestEngine.text(NOTES) === SEED ? true : undefined), 15_000);
check('guest opens and fetches over wss', true);

// Guest edit converges on the host, through the proxy.
hostFiles.texts.set(NOTES, `${SEED}guest line\n`);
hostBridge.documentChanged(NOTES);
await waitFor(
  'guest to converge on the host edit',
  () => (guestEngine.text(NOTES) === `${SEED}guest line\n` ? true : undefined),
  15_000,
);
check('host edit converges on the guest', true);

// And back: a guest keystroke reaches the host through the proxy.
const guestModel = guestModels[0];
if (guestModel === undefined) throw new Error('guest never built the model');
guestModel.pushEditOperations(
  [],
  [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'guest key\n' }],
  () => null,
);
guestModel.__fire();
await waitFor(
  'host to converge on the guest edit',
  () => (hostEngine.text(NOTES).includes('guest key') ? true : undefined),
  15_000,
);
check('guest edit converges on the host', true);

binding.dispose();
await guestEngine.disconnect();
await hostEngine.disconnect();
console.log('PROOF OK');
