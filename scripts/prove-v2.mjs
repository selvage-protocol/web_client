/**
 * Live proof for `selvage/2` in the browser: a real Chromium guest on a real page, a real room on
 * a real one-origin server, and an edit in both directions.
 *
 * What runs where, and why. The **guest** is a real browser: joining needs nothing but the link in
 * the address bar, and what this proof is about — the page deriving a version-2 room from `§5.1`'s
 * fragment, showing the room's text, publishing a keystroke — is the page's own code, rendered.
 * The **host** is this process, driving the same engine the page drives (`src/engine` and
 * `src/bridge`, the copies the page bundles): hosting in a browser needs a folder picked through
 * `showDirectoryPicker`, which no automation can answer, and a proof that stubbed the picker would
 * be proving the stub.
 *
 * The server is one origin: `selvaged --serve-page dist` answers `/` with the built page and
 * `/session` with the room, so the link's origin *is* the address the guest dials —
 * `PROTOCOL.md` §5.1's shape, with no second server to point at. No version flag is needed or
 * exists: a server built from this revision seats `selvage/2`, the one wire.
 *
 * Screenshots go to `.tmp/prove-v2/` — inside the checkout, where `/tmp` is never used, and
 * ignored by git, which keeps a proof run from leaving anything in the tree.
 *
 * Usage:
 *   node scripts/prove-v2.mjs
 *   SELVAGE_CHROMIUM=/path/to/chromium node scripts/prove-v2.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';

import { PeerEngine } from '../src/bridge/index.ts';
import { parseInvite } from '../src/engine/peer.ts';
import { encodeKey } from '../src/engine/sealed.ts';

const ROOT = resolve(import.meta.dirname, '..');
const IMAGES = resolve(ROOT, '.tmp', 'prove-v2');
const PATH = 'notes.md';
const SEED = '# a room two clients share\n';
const FROM_GUEST = 'guest was here';
const FROM_HOST = 'host was here';

function log(...parts) {
  console.log('[prove-v2]', ...parts);
}

/** A Chromium from the store, or whatever `SELVAGE_CHROMIUM` names. */
function chromiumBinary() {
  const named = process.env['SELVAGE_CHROMIUM'];
  if (named !== undefined && named !== '') {
    return named;
  }
  const store = '/nix/store';
  // The store holds one path per version and the path's hash sorts arbitrarily, so the version is
  // what is compared: the newest of what is there, not whichever name happened to sort last.
  const found = readdirSync(store)
    .map((entry) => /^[a-z0-9]{32}-chromium-(\d[\d.]*)$/.exec(entry))
    .filter((match) => match !== null)
    .map((match) => ({
      version: match[1],
      path: resolve(store, match[0], 'bin', 'chromium'),
    }))
    .filter(({ path }) => existsSync(path))
    .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }));
  if (found.length === 0) {
    throw new Error('no chromium found; set SELVAGE_CHROMIUM to one');
  }
  return found[found.length - 1].path;
}

/**
 * A built `selvaged`: the one `SELVAGE_SELVAGED` names, or the sibling checkout's, which sits one
 * level further up when this runs from a worktree.
 */
function selvagedBinary() {
  const named = process.env['SELVAGE_SELVAGED'];
  if (named !== undefined && named !== '') {
    return named;
  }
  for (const parent of [resolve(ROOT, '..'), resolve(ROOT, '..', '..'), resolve(ROOT, '..', '..', '..')]) {
    for (const profile of ['debug', 'release']) {
      const path = resolve(parent, 'reference_server', 'target', profile, 'selvaged');
      if (existsSync(path)) {
        return path;
      }
    }
  }
  throw new Error('no selvaged found; set SELVAGE_SELVAGED to one');
}

/** `selvaged` serving the built page and seating both versions, on an ephemeral loopback port. */
async function startServer() {
  const binary = selvagedBinary();
  const page = resolve(ROOT, 'dist');
  if (!existsSync(resolve(page, 'index.html'))) {
    throw new Error('dist/index.html is missing; run `npm run build` first');
  }
  const child = spawn(
    binary,
    ['--listen', '127.0.0.1:0', '--serve-page', page],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const address = await new Promise((resolve_, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error('selvaged did not report an address in 10s')), 10_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const match = /ws:\/\/([0-9.]+:[0-9]+)\/session/.exec(stdout);
      if (match !== null) {
        clearTimeout(timer);
        resolve_(match[1]);
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`selvaged could not be started: ${error.message}`));
    });
    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('selvaged exited before it was ready'));
    });
  });
  return {
    origin: `http://${address}`,
    wsBase: `ws://${address}`,
    stop: () => {
      child.kill('SIGKILL');
    },
  };
}

/** The smallest CDP driver this proof needs: one page, evaluate, type, screenshot. */
async function launchChromium(port) {
  // Chromium puts its process-singleton socket under `TMPDIR`, and the path it hands the kernel is
  // bounded at about 108 bytes: an absolute `.tmp/…` under a worktree checkout with the socket name
  // on its end is over the bound, and Chromium 153 refuses to start with "Socket path too long"
  // before it opens a page. The bound is on the string, not on where it resolves, so the browser's
  // `TMPDIR` is relative and it is spawned with the checkout root as its working directory: `.tmp/`
  // is already ignored and this directory is removed with the run. `/tmp` is never used here: it is
  // RAM. `SELVAGE_CHROMIUM_TMPDIR` names another, and `SELVAGE_CHROMIUM_PROFILE` a profile.
  const tmp = process.env['SELVAGE_CHROMIUM_TMPDIR'] ?? '.tmp/chromium';
  const profile = process.env['SELVAGE_CHROMIUM_PROFILE'] ?? `${tmp}/pv2`;
  rmSync(resolve(ROOT, profile), { recursive: true, force: true });
  mkdirSync(resolve(ROOT, profile), { recursive: true });
  const browser = spawn(
    chromiumBinary(),
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1280,900',
      'about:blank',
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: tmp } },
  );
  let wsUrl;
  try {
    wsUrl = await new Promise((resolve_, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('Chromium never reported a DevTools url')), 20_000);
      browser.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Chromium could not be started: ${error.message}`));
      });
      browser.stderr.on('data', (chunk) => {
        buffer += chunk.toString();
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
        if (match !== null) {
          clearTimeout(timer);
          resolve_(match[1]);
        }
      });
      browser.on('exit', () => {
        clearTimeout(timer);
        reject(new Error(`Chromium exited before it was ready: ${buffer.trim().slice(-400)}`));
      });
    });
  } catch (error) {
    // A browser that never became ready is still a process: it is killed here, so a failed launch
    // is a report rather than a run that keeps the terminal until someone notices.
    browser.kill('SIGKILL');
    throw error;
  }

  const socket = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((resolve_, reject) => {
    socket.once('open', resolve_);
    socket.once('error', reject);
  });
  let nextId = 1;
  const pending = new Map();
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const entry = pending.get(message.id);
    if (entry === undefined) {
      return;
    }
    pending.delete(message.id);
    if (message.error !== undefined) {
      entry.reject(new Error(`${message.error.message}`));
      return;
    }
    entry.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve_, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve_, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    });

  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((target) => target.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const psend = (method, params = {}) => send(method, params, sessionId);
  await psend('Page.enable');
  await psend('Runtime.enable');

  return {
    async navigate(url) {
      await psend('Page.navigate', { url });
      await delay(2500);
    },
    async evaluate(expression) {
      const result = await psend('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails !== undefined) {
        const thrown = result.exceptionDetails.exception;
        throw new Error(
          `the page threw: ${thrown?.description ?? JSON.stringify(result.exceptionDetails).slice(0, 400)}`,
        );
      }
      return result.result?.value;
    },
    async type(text) {
      // A person types into the file they just opened, so the editor's own input is what is
      // focused first: `Input.insertText` goes wherever the page's focus already is.
      await psend('Runtime.evaluate', {
        expression: "document.querySelector('.monaco-editor textarea.inputarea')?.focus()",
        userGesture: true,
      });
      await psend('Input.insertText', { text });
    },
    async shot(path) {
      const { data } = await psend('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    async stop() {
      try {
        socket.close();
      } catch {
        // Already gone.
      }
      browser.kill('SIGKILL');
      rmSync(resolve(ROOT, tmp), { recursive: true, force: true });
    },
  };
}

/** The text the page's editor holds, whichever editor it built. */
const PAGE_TEXT = `(() => {
  // Monaco keeps no model on the global object, so what it holds is read off the screen: the
  // lines it has drawn, which for a proof's handful of lines is the whole document. A line's
  // own text carries zero-width spaces and non-breaking spaces Monaco draws with, and a
  // comparison against the room's text must not fail on one of those.
  const clean = (text) => text.replace(/\\u200b/g, '').replace(/\\u00a0/g, ' ');
  const editor = document.querySelector('.monaco-editor');
  if (editor !== null) {
    const lines = [...editor.querySelectorAll('.view-line')].map((line) => clean(line.textContent ?? ''));
    if (lines.length > 0) {
      return lines.join('\\n');
    }
  }
  return [...document.querySelectorAll('textarea, [contenteditable]')]
    .map((node) => clean(node.value ?? node.textContent ?? ''))
    .join('\\n');
})()`;

/** Waits for the page to satisfy a predicate, with a deadline that reports what it saw. */
async function waitForPage(page, label, predicate, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const text = await page.evaluate(PAGE_TEXT);
    if (predicate(text)) {
      return text;
    }
    if (Date.now() >= deadline) {
      const shown = await page.evaluate('document.body.innerText.slice(0, 400)');
      throw new Error(
        `timed out after ${deadlineMs}ms waiting for ${label}; the page held ${JSON.stringify(text)}` +
          ` and showed ${JSON.stringify(shown)}`,
      );
    }
    await delay(200);
  }
}

/**
 * The guest's own act, made the way a person makes it: a name in the card and Join. A page that
 * was handed the room in its address bar still joins from that card, and the link it joins by is
 * the address bar's own — the card's paste field is hidden while the address *is* the invite.
 */
async function joinFromTheCard(page, displayName) {
  await page.evaluate(`(() => {
    const name = document.getElementById('name');
    if (name !== null && name.value === '') {
      name.value = ${JSON.stringify(displayName)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const button = document.getElementById('join-button');
    if (button === null) {
      throw new Error('the join card has no button');
    }
    button.click();
    return document.getElementById('name').value;
  })()`);
}

/**
 * Opens a path from the shared tree, which is how a guest fetches a document it does not hold —
 * and the wait for that row, because a page that has only just joined has not drawn the room's
 * listing yet.
 */
async function openFromTheTree(page, path, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const report = await page.evaluate(`(() => {
      // A row's text is the file's badge and its name — MDnotes.md — and the name is the one
      // span in it that carries no class.
      const wanted = ${JSON.stringify(path)};
      const name = wanted.slice(wanted.lastIndexOf('/') + 1);
      const rows = [...document.querySelectorAll('#tree button.row')];
      const row = rows.find((node) =>
        [...node.querySelectorAll('span')].some(
          (span) => span.className === '' && span.textContent === name,
        ),
      );
      if (row !== undefined) {
        row.click();
        return { opened: true };
      }
      const pane = document.getElementById('tree');
      return {
        opened: false,
        rows: rows.map((node) => node.textContent),
        tree: pane === null ? 'no tree pane' : pane.innerHTML.slice(0, 200),
      };
    })()`);
    if (report.opened === true) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${deadlineMs}ms waiting for the shared tree to list ${path}; it held ` +
          `${JSON.stringify(report.rows)} and ${report.tree}`,
      );
    }
    await delay(200);
  }
}

async function main() {
  mkdirSync(IMAGES, { recursive: true });
  const server = await startServer();
  let host;
  let chromium;
  try {
    log('selvaged serving the page and selvage/2 at', server.origin);

    const tree = [PATH];
    const listing = {
      current: () => tree,
      replace: (paths) => {
        tree.length = 0;
        tree.push(...paths);
      },
    };
    host = await PeerEngine.host({
      baseUrl: server.wsBase,
      displayName: 'Ada',
      listing,
    });
    const invite = host.inviteUrl();
    if (invite === undefined) {
      throw new Error('the host minted no invite');
    }
    const read = parseInvite(invite);
    if (!read.ok) {
      throw new Error(`the invite is not readable: ${read.reason}`);
    }
    if (!/^#k=[A-Za-z0-9_-]{43}&h=[A-Za-z0-9_-]{43}$/.test(invite.slice(invite.indexOf('#')))) {
      throw new Error(`§5.1's fragment is not both keys: ${invite}`);
    }
    log('the room is minted; its fragment carries both keys');

    log('the host seeds the document');
    host.open(PATH);
    await new Promise((resolve_) => setTimeout(resolve_, 100));
    host.insert(PATH, 0, SEED);

    // The link a person is handed: `§5.1`'s second form, the page's own origin with the fragment on
    // it. The guest is a real page loading exactly this.
    const fragment = `#k=${encodeKey(read.invite.roomKey)}&h=${encodeKey(read.invite.hostKey)}`;
    const pageLink =
      `${server.origin}/?room=${encodeURIComponent(read.invite.room)}` +
      `&token=${encodeURIComponent(read.invite.token)}${fragment}`;
    log('the guest opens', pageLink);

    chromium = await launchChromium(9339);
  await chromium.navigate(pageLink);
    await joinFromTheCard(chromium, 'Bob');
    // The room's listing is the guest's to see; the document itself arrives when it is opened,
    // which is the page's rule for both versions and not a version-2 one.
    await openFromTheTree(chromium, PATH);
    const seen = await waitForPage(chromium, "the room's text to arrive", (text) => text.includes(SEED.trim()));
    log('the page holds', JSON.stringify(seen));
    await chromium.shot(resolve(IMAGES, 'prove-v2-guest-joined.png'));

    // The guest's own edit, made the way a person makes one: typed into the page.
    await chromium.type(`\n${FROM_GUEST}`);
    const arrived = await waitFor(
      () => (host.text(PATH).includes(FROM_GUEST) ? host.text(PATH) : undefined),
      'the guest edit to reach the room',
    );
    log('the room holds the guest edit:', JSON.stringify(arrived));
    await chromium.shot(resolve(IMAGES, 'prove-v2-guest-typed.png'));

    host.insert(PATH, host.text(PATH).length, `${FROM_HOST}\n`);
    const back = await waitForPage(chromium, 'the host edit to reach the page', (text) =>
      text.includes(FROM_HOST),
    );
    log('the page holds the host edit:', JSON.stringify(back));
    await chromium.shot(resolve(IMAGES, 'prove-v2-both-directions.png'));

    const role = await chromium.evaluate(`document.body.innerText.includes('guest')`);
    log('the page reads itself as a guest:', role);
    log(`wrote ${relative(ROOT, IMAGES)}/prove-v2-*.png`);
    log('a real browser joined a selvage/2 room by its fragment link and exchanged an edit with the host, both directions');
  } finally {
    // Every failure path comes through here: a browser that never launched, an invite that did
    // not carry both keys, the page timing out. The server's pipes and the host's socket hold
    // the event loop open, so a script that reported a failure and then hung would be the one
    // thing this proof must not do.
    await chromium?.stop();
    host?.disconnect();
    server.stop();
  }
}

async function waitFor(check, label, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const value = check();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${deadlineMs}ms waiting for ${label}`);
    }
    await delay(100);
  }
}

try {
  await main();
} catch (error) {
  console.error('[prove-v2] FAILED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
