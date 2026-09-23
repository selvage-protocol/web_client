/**
 * Live proof for the version a hosting page mints at (`PROTOCOL.md` §2, §10), in a real browser.
 *
 * Two servers, one page: a `selvaged` that seats both versions, and one started with
 * `--serve-version-1-only`. Against each, the host card is read out of the page the server serves —
 * whether the action is offered, and the sentence that stands where it is not — and every sentence
 * is compared with `hostRefusalSentence(hostDecision(meta, search))` computed from that server's own
 * live `/meta`, so the page's copy and the server's answer cannot drift apart without this failing.
 *
 * What it cannot do is press *Start a session here*: hosting reaches `showDirectoryPicker`, which no
 * automation can answer, and a proof that stubbed the picker would be proving the stub. So the
 * version-1 join of the last case is what the browser is asked for here: a room is minted from this
 * process with the engine the page bundles — as `prove-v2.mjs` does for its guest — and the page
 * served by the version-1-only server joins it from its own card, which is the half of "a page there
 * still joins, and cannot host unless it is pinned" a browser can be made to answer.
 *
 * Screenshots go to `.tmp/prove-host-version/`, inside the checkout, where the Chromium profile and
 * every artefact stay.
 *
 * Usage:
 *   node scripts/prove-host-version.mjs
 *   SELVAGE_SELVAGED=/path/to/selvaged SELVAGE_CHROMIUM=/path/to/chromium node scripts/prove-host-version.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';

import { HOST_TAB_WARNING, hostRefusalSentence } from '../src/browser/host.ts';
import { hostDecision } from '../src/browser/relay.ts';
import { nativeWebSocketFactory } from '../src/browser/transport.ts';
import { SelvageEngine as Engine } from '../src/engine/index.ts';

const ROOT = resolve(import.meta.dirname, '..');
const IMAGES = resolve(ROOT, '.tmp', 'prove-host-version');
const PATH = 'notes.md';
const SEED = '# the server seats this room at one version\n';
/** The DevTools port the one browser is driven on. */
const PORT = 9341;

function log(...parts) {
  console.log('[prove-host-version]', ...parts);
}

/** A Chromium from the store, or whatever `SELVAGE_CHROMIUM` names. */
function chromiumBinary() {
  const named = process.env['SELVAGE_CHROMIUM'];
  if (named !== undefined && named !== '') {
    return named;
  }
  const store = '/nix/store';
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

/**
 * `selvaged` serving the built page on an ephemeral loopback port, with `flags` as the seat the
 * case is about. No version flag is the default seat, which is both versions.
 */
async function startServer(flags) {
  const binary = selvagedBinary();
  const page = resolve(ROOT, 'dist');
  if (!existsSync(resolve(page, 'index.html'))) {
    throw new Error('dist/index.html is missing; run `npm run build` first');
  }
  const child = spawn(binary, ['--listen', '127.0.0.1:0', '--serve-page', page, ...flags], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  const origin = `http://${address}`;
  return {
    origin,
    wsBase: `ws://${address}`,
    /** The server's own `/meta`, read over HTTP exactly as the page's own same-origin read is. */
    meta: async () => {
      const response = await fetch(`${origin}/meta`);
      if (!response.ok) {
        throw new Error(`/meta answered ${response.status}`);
      }
      return await response.json();
    },
    stop: () => {
      child.kill('SIGKILL');
    },
  };
}

/**
 * The browser's own scratch, as a name relative to the checkout root, and relative on purpose.
 *
 * Chromium puts its process-singleton socket under `TMPDIR`, and the path it hands the kernel is
 * bounded at about 108 bytes: an absolute `.tmp/…` under a worktree checkout with
 * `org.chromium.Chromium.XXXXXX/SingletonSocket` on the end of it is over the bound, and Chromium
 * 153 refuses to start at all — "Socket path too long" — before it opens a page. The bound is on
 * the string, not on where it resolves, so a relative `TMPDIR` stays short however deep the
 * checkout is: the browser is spawned with the checkout root as its working directory, `.tmp/` is
 * already ignored, and this directory is removed with the run. `SELVAGE_CHROMIUM_TMPDIR` names
 * another. `/tmp` is never used: it is RAM on this host.
 */
function browserTmp() {
  const dir = process.env['SELVAGE_CHROMIUM_TMPDIR'] ?? '.tmp/chromium';
  rmSync(resolve(ROOT, dir), { recursive: true, force: true });
  mkdirSync(resolve(ROOT, dir), { recursive: true });
  return dir;
}

/** The smallest CDP driver this proof needs: one page, evaluate, screenshot. */
async function launchChromium(port) {
  const tmp = browserTmp();
  const profile = process.env['SELVAGE_CHROMIUM_PROFILE'] ?? `${tmp}/profile`;
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
    },
  };
}

/**
 * The host card as the person sees it: whether the wrap and the button are offered, and the
 * sentence beside them. The page writes the note's text itself, so the text is compared as it
 * stands rather than through markup.
 */
const CARD = `(() => {
  const wrap = document.getElementById('host-wrap');
  const button = document.getElementById('host-button');
  const note = document.getElementById('host-note');
  return {
    wrapHidden: wrap === null ? null : wrap.hidden,
    buttonHidden: button === null ? null : button.hidden,
    note: note === null ? null : note.textContent ?? '',
  };
})()`;

/** The text the page's editor holds, whichever editor it built. */
const PAGE_TEXT = `(() => {
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

/** Waits for a predicate over one evaluated expression, with a deadline that reports what it saw. */
async function waitForRead(page, label, expression, predicate, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const read = await page.evaluate(expression);
    if (predicate(read)) {
      return read;
    }
    if (Date.now() >= deadline) {
      const shown = await page.evaluate('document.body.innerText.slice(0, 400)');
      throw new Error(
        `timed out after ${deadlineMs}ms waiting for ${label}; the page held ${JSON.stringify(read)}` +
          ` and showed ${JSON.stringify(shown)}`,
      );
    }
    await delay(200);
  }
}

/** The card, once the bundle has decided it: the wrap is revealed by that decision and nothing else. */
function waitForCard(page, label) {
  return waitForRead(page, label, CARD, (card) => card.wrapHidden === false && card.note !== '');
}

/** The guest's own act, made the way a person makes it: a name in the card and Join. */
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

/** Opens a path from the shared tree, which is how a guest fetches a document it does not hold. */
async function openFromTheTree(page, path, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const report = await page.evaluate(`(() => {
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

function check(name, condition) {
  if (!condition) {
    throw new Error(`FAILED: ${name}`);
  }
  log('ok:', name);
}

async function main() {
  mkdirSync(IMAGES, { recursive: true });
  const both = await startServer([]);
  const oneOnly = await startServer(['--serve-version-1-only']);
  let chromium;
  let host;
  try {
    chromium = await launchChromium(PORT);

    // === A server that seats both versions: an unpinned page offers to host, at the encrypted wire.
    const bothMeta = await both.meta();
    log('the default server advertises', JSON.stringify(bothMeta.wire_versions));
    const bothDecision = hostDecision(bothMeta, '');
    check(
      'an unpinned page on a server that seats both mints selvage/2',
      bothDecision.outcome === 'mint' && bothDecision.version === 'selvage/2',
    );
    await chromium.navigate(`${both.origin}/`);
    const offered = await waitForCard(chromium, 'the card on the both-seated server');
    check('the card offers the host action', offered.buttonHidden === false);
    check('the card carries the tab warning, not a refusal', offered.note === HOST_TAB_WARNING);
    await chromium.shot(resolve(IMAGES, 'both-seated-offered.png'));

    // === A server that seats `selvage/1` alone: the refusal is the card's own sentence, and the
    // action is not offered, so nothing that could only refuse is on screen.
    const oneMeta = await oneOnly.meta();
    log('the version-1-only server advertises', JSON.stringify(oneMeta.wire_versions));
    const autoDecision = hostDecision(oneMeta, '');
    check(
      'an unpinned page on a version-1-only server is refused, not fallen back',
      autoDecision.outcome === 'refuse' && autoDecision.reason === 'not-seated',
    );
    const autoSentence = hostRefusalSentence(autoDecision);
    await chromium.navigate(`${oneOnly.origin}/`);
    const refused = await waitForCard(chromium, 'the card on the version-1-only server');
    check('the host action is not offered where it could only refuse', refused.buttonHidden === true);
    check('the card shows the refusal the decision words', refused.note === autoSentence);
    check('the refusal names the version it would need', refused.note.includes('selvage/2'));
    check('the refusal names what the server offers', refused.note.includes('selvage/1'));
    await chromium.shot(resolve(IMAGES, 'one-only-refused.png'));

    // === The same server, pinned to what it seats: the action is offered again.
    const pinned = hostDecision(oneMeta, '?wire=1');
    check('a page pinned to selvage/1 mints it', pinned.outcome === 'mint' && pinned.version === 'selvage/1');
    await chromium.navigate(`${oneOnly.origin}/?wire=1`);
    const pinnedCard = await waitForCard(chromium, 'the pinned card on the version-1-only server');
    check('a pinned page offers the host action', pinnedCard.buttonHidden === false);
    check('a pinned page carries the tab warning', pinnedCard.note === HOST_TAB_WARNING);
    await chromium.shot(resolve(IMAGES, 'one-only-pinned-offered.png'));

    // === And pinned to what it does not: refused, with the pin named.
    const pinRefusal = hostDecision(oneMeta, '?wire=2');
    check(
      'a pin the server does not seat is refused',
      pinRefusal.outcome === 'refuse' && pinRefusal.reason === 'pin-not-seated',
    );
    const pinSentence = hostRefusalSentence(pinRefusal);
    await chromium.navigate(`${oneOnly.origin}/?wire=2`);
    const pinCard = await waitForCard(chromium, 'the pin-refused card on the version-1-only server');
    check('the pinned refusal is not offered the action either', pinCard.buttonHidden === true);
    check('the pin refusal names the pin and what is offered', pinCard.note === pinSentence);
    check('the pin refusal names selvage/2 as the pin', pinCard.note.includes('selvage/2'));

    // === An endpoint that did not answer is not an answer: `/meta` on a port nothing listens on.
    const deadMeta = await fetch('http://127.0.0.1:1/meta').then(
      () => 'answered',
      () => undefined,
    );
    check('a /meta that could not be read is undefined', deadMeta === undefined);
    const attempted = hostDecision(undefined, '');
    check(
      'an unreadable /meta attempts selvage/2',
      attempted.outcome === 'mint' && attempted.version === 'selvage/2',
    );

    // === The other half: the page served by the version-1-only server still joins a version-1 room.
    host = await Engine.host(oneOnly.wsBase, 'Ada', {
      webSocketFactory: nativeWebSocketFactory,
      client: 'selvage-web',
    });
    await host.grant([PATH]);
    host.open(PATH);
    await delay(150);
    host.insert(PATH, 0, SEED);
    const session = host.session();
    const guestLink = `${oneOnly.origin}/?room=${encodeURIComponent(session.roomId)}&token=${encodeURIComponent(session.token ?? '')}`;
    log('the version-1 room is minted; the guest opens', guestLink);
    await chromium.navigate(guestLink);
    await waitForRead(
      chromium,
      'the bundle to arm the join card on the version-1-only page',
      'window.__selvageJoinArmed === true',
      (armed) => armed === true,
    );
    await joinFromTheCard(chromium, 'Bob');
    await openFromTheTree(chromium, PATH);
    const seen = await waitForRead(chromium, "the room's text to arrive", PAGE_TEXT, (text) =>
      text.includes(SEED.trim()),
    );
    log('the page on the version-1-only server holds', JSON.stringify(seen));
    await chromium.shot(resolve(IMAGES, 'one-only-guest-joined.png'));
    check('a page there still joins a version-1 room', seen.includes(SEED.trim()));

    log(`wrote ${relative(ROOT, IMAGES)}/prove-host-version-*.png`);
    log(
      'a real browser showed the hosting decision: offered where the server seats the encrypted wire, ' +
        'a sentence where it does not, the pin honoured both ways, and a version-1 join still reached',
    );
  } finally {
    await chromium?.stop();
    host?.disconnect();
    both.stop();
    oneOnly.stop();
    rmSync(resolve(ROOT, process.env['SELVAGE_CHROMIUM_TMPDIR'] ?? '.tmp/chromium'), {
      recursive: true,
      force: true,
    });
  }
}

try {
  await main();
} catch (error) {
  console.error('[prove-host-version] FAILED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
