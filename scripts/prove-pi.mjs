/**
 * Live proof for the browser stack, without a browser on this host.
 *
 * Drives the scaffold's own code — the synced engine copy, the native WebSocket
 * factory the page passes, and the session bridge — against a real `selvaged`:
 * the room is minted by the existing VS Code engine, the guest joins exactly the
 * way the page does, both sides edit, presence crosses, the guest socket is cut,
 * and the room converges again. What is not covered here is Monaco itself; the
 * adapter owns no protocol logic beyond offset mapping, which both sides count in
 * UTF-16 code units.
 *
 * Usage: SELVAGE_BASE=ws://100.64.0.3:8080 node scripts/prove-pi.mjs
 */

import { applyChange, SessionBridge } from '../src/bridge/index.ts';
import { SelvageEngine as WebEngine } from '../src/engine/index.ts';
import { nativeWebSocketFactory } from '../src/browser/transport.ts';
import { SelvageEngine as HostEngine } from '../../vscode_client/src/engine/engine.ts';

const BASE = process.env.SELVAGE_BASE ?? 'ws://100.64.0.3:8080';
const PATH = 'prove-notes.txt';
const SEED = 'line one\nline two\n';

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
    if (current === undefined) {
      return false;
    }
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

async function waitFor(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = predicate();
    if (seen !== undefined) {
      return seen;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const hostEngine = await HostEngine.host(BASE, 'prove-host', { client: 'web-prove/host' });
const invite = hostEngine.inviteUrl();
if (invite === undefined) {
  throw new Error('host minted no invite');
}
console.log(`room minted by existing engine: ${hostEngine.session().roomId}`);

const hostFiles = new MemHost();
hostFiles.texts.set(PATH, SEED);
const hostBridge = new SessionBridge({ engine: hostEngine, host: hostFiles });
hostBridge.documentOpened(PATH);

let guestSocket;
const capturingFactory = (url) => {
  guestSocket = nativeWebSocketFactory(url);
  return guestSocket;
};
// The page joins with `meta: 'skip'` (`/meta` answers without CORS headers), so the
// guest here does the same; the host above ran the default meta check.
const guestEngine = await WebEngine.join(invite, 'prove-web', {
  webSocketFactory: capturingFactory,
  meta: 'skip',
  client: 'web_client/0.1.0',
});
console.log(`guest joined as ${guestEngine.session().role} over native WebSocket`);

const guestFiles = new MemHost();
guestFiles.texts.set(PATH, '');
const guestBridge = new SessionBridge({ engine: guestEngine, host: guestFiles });
guestBridge.documentOpened(PATH);

await waitFor(
  'guest to receive the seed',
  () => (guestEngine.has(PATH) && guestEngine.text(PATH) === SEED ? true : undefined),
  10_000,
);
console.log('guest holds the host seed');

guestEngine.setSelection(PATH, { anchor: 0, head: 5 });
const seen = await waitFor(
  'host to see the guest cursor',
  () => hostEngine.presence().find((peer) => peer.state?.path === PATH && peer.state.selection !== undefined),
  10_000,
);
const resolved = hostEngine.resolveSelection(PATH, seen.state.selection);
console.log(`presence crosses: path=${seen.state.path} anchor=${resolved?.anchor} head=${resolved?.head} (guest ${seen.peer?.display_name})`);

const afterHost = `${SEED}host line\n`;
hostFiles.texts.set(PATH, afterHost);
hostBridge.documentChanged(PATH);
await waitFor(
  'guest to converge on the host edit',
  () => (guestEngine.text(PATH) === afterHost ? true : undefined),
  10_000,
);
console.log('host edit converged on the guest');

const afterGuest = afterHost.replace('line two', 'line TWO (web)');
guestFiles.texts.set(PATH, afterGuest);
guestBridge.documentChanged(PATH);
await waitFor(
  'host to converge on the guest edit',
  () => (hostEngine.text(PATH) === afterGuest ? true : undefined),
  10_000,
);
console.log('guest edit converged on the host');

let reconnecting = false;
const stop = guestEngine.on((event) => {
  if (event.type === 'reconnecting') {
    reconnecting = true;
  }
});
guestSocket.close();
await waitFor('engine to notice the cut socket', () => (reconnecting ? true : undefined), 10_000);
console.log('guest reconnects after the socket is cut');

const afterReconnect = `${afterGuest}back again\n`;
guestFiles.texts.set(PATH, afterReconnect);
guestBridge.documentChanged(PATH);
await waitFor(
  'room to converge after reconnect',
  () => (hostEngine.text(PATH) === afterReconnect && guestEngine.text(PATH) === afterReconnect
    ? true
    : undefined),
  15_000,
);
stop();
console.log('room converged after reconnect');
console.log(`final text (${afterReconnect.length} chars) identical on both ends`);

await guestEngine.disconnect();
await hostEngine.disconnect();
console.log('PROOF OK');
