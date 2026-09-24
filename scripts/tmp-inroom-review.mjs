/**
 * Scratch driver: the in-room chrome, made reviewable in a real browser.
 *
 * A headless browser cannot answer `showDirectoryPicker` — the dialog belongs to the browser — so
 * the shipped page's host card was the furthest a review could get, and the in-room chrome (the
 * create-file row, the copy control, the rename control, the host marker, Leave, the tree, the
 * editor) was never photographed. This opens the page with a page init script that stands in for
 * the picker with the browser's *real* `FileSystemDirectoryHandle` over the origin private file
 * system, hosts a room, opens one of its files, and screenshots the result at a desktop and a
 * phone width. Only the dialog is stubbed; everything after the pick is the real API.
 *
 * The same technique is what the project used before (`BROWSER_NOTES.md`, "Seen in a browser"),
 * and this file is the small, committed version of it for a visual review.
 *
 * With `--footer` (or `SELVAGE_FOOTER=1`) the demo deployment's footer — the non-commercial
 * notice and its terms link, injected before `</body>` by the demo's nginx — is appended to the
 * page, so the phone shot shows whether it is reachable without hunting.
 *
 * Screenshots and the measured facts land in `.tmp/inroom-review/`, inside the checkout; `/tmp` is
 * RAM on this host and is never used.
 *
 * Usage:
 *   node scripts/tmp-inroom-review.mjs
 *   node scripts/tmp-inroom-review.mjs --footer
 *   SELVAGE_SELVAGED=/path/to/selvaged SELVAGE_CHROMIUM=/path/to/chromium node scripts/tmp-inroom-review.mjs
 *
 * Plain `node` strips the types of the `.ts` files this imports, which needs Node 22.18+ or
 * 23.6+ (the suite's own floor); on an older 22.x add `--experimental-strip-types`.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';

import { encodeKey } from '../src/engine/index.ts';
import { PeerEngine } from '../src/bridge/index.ts';
import { nativeWebSocketFactory } from '../src/browser/transport.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, '.tmp', 'inroom-review');
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
const FOOTER = process.argv.includes('--footer') || process.env['SELVAGE_FOOTER'] === '1';

function log(...parts) {
  console.log('[inroom-review]', ...parts);
}

/** A Chromium from the store, or whatever `SELVAGE_CHROMIUM` names. */
function chromiumBinary() {
  const named = process.env['SELVAGE_CHROMIUM'];
  if (named !== undefined && named !== '') {
    return named;
  }
  const found = readdirSync('/nix/store')
    .map((entry) => /^[a-z0-9]{32}-chromium-(\d[\d.]*)$/.exec(entry))
    .filter((match) => match !== null)
    .map((match) => ({ version: match[1], path: resolve('/nix/store', match[0], 'bin', 'chromium') }))
    .filter(({ path }) => existsSync(path))
    .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }));
  if (found.length === 0) {
    throw new Error('no chromium found; set SELVAGE_CHROMIUM to one');
  }
  return found[found.length - 1].path;
}

/** A built `selvaged`: the one `SELVAGE_SELVAGED` names, or the sibling checkout's. */
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
 * `selvaged` serving the built page, page and socket on one origin. The address it prints is the
 * origin the guest's own page is served from, which is `PROTOCOL.md` §5.1's shape.
 */
async function startServer() {
  const page = resolve(ROOT, 'dist');
  if (!existsSync(resolve(page, 'index.html'))) {
    throw new Error('dist/index.html is missing; run `npm run build` first');
  }
  const child = spawn(selvagedBinary(), ['--listen', '127.0.0.1:0', '--serve-page', page], {
    stdio: ['ignore', 'pipe', 'inherit'],
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
  return { origin: `http://${address}`, stop: () => child.kill('SIGKILL') };
}

/**
 * The picker's stand-in, added before any page script: the *real* `FileSystemDirectoryHandle` for
 * an origin-private directory, seeded the way a small project folder is. `showDirectoryPicker` is
 * the one thing automation cannot answer, so it is the only thing replaced.
 */
const PICKER_STAND_IN = `(() => {
  const SEED = {
    'README.md': '# Hosted from the browser\\n\\nEvery file here is the room, and its text arrives when somebody opens it.\\n',
    'notes.md': '# Room notes\\n\\n- one host, any number of guests\\n',
    'src/main.ts': 'export function add(a: number, b: number): number {\\n  return a + b;\\n}\\n',
  };
  const write = async (dir, name, text) => {
    const file = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await file.write(text);
    await file.close();
  };
  const build = async () => {
    const root = await navigator.storage.getDirectory();
    try {
      await root.removeEntry('project', { recursive: true });
    } catch {
      // Nothing from a previous run.
    }
    const project = await root.getDirectoryHandle('project', { create: true });
    for (const [path, text] of Object.entries(SEED)) {
      const parts = path.split('/');
      let parent = project;
      for (const part of parts.slice(0, -1)) {
        parent = await parent.getDirectoryHandle(part, { create: true });
      }
      await write(parent, parts[parts.length - 1], text);
    }
    return project;
  };
  window.showDirectoryPicker = () => build();
})();`;

/** The demo's own footer, the shape its nginx injects before `</body>`. */
const FOOTER_INJECTION = `(() => {
  const aside = document.createElement('aside');
  aside.id = 'demo-footer';
  aside.style.cssText = 'box-sizing:border-box;padding:.65rem 1rem;font:14px/1.45 system-ui,sans-serif;text-align:center;color:#a6adc8;background:#181825;border-top:1px solid #313244';
  aside.innerHTML = 'Demo instance: <strong style="color:#f9e2af">non-commercial use only.</strong> Not a hosted product; rooms are not persisted and may be reset at any time. <a id="terms-link" style="color:#cba6f7" href="/terms">Terms of use</a>';
  document.body.appendChild(aside);
})();`;

/** The smallest CDP driver this needs: one page, evaluate, screenshot, device metrics. */
async function launchChromium() {
  // Chromium's scratch: the named base directory is a *base*, and only this script's own
  // subdirectory under it is ever removed, so an absolute `SELVAGE_CHROMIUM_TMPDIR` (or a shared
  // one) cannot have its other contents deleted. The default stays relative: Chromium puts its
  // process-singleton socket under `TMPDIR`, that path is bounded at about 108 bytes, and an
  // absolute path under a worktree is past it (`prove-host-version.mjs` carries the long form).
  const base = process.env['SELVAGE_CHROMIUM_TMPDIR'] ?? '.tmp';
  const tmp = `${base}/inroom-chromium`;
  rmSync(resolve(ROOT, tmp), { recursive: true, force: true });
  mkdirSync(resolve(ROOT, tmp), { recursive: true });
  const profile = `${tmp}/profile`;
  const browser = spawn(
    chromiumBinary(),
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      `--window-size=${DESKTOP.width},${DESKTOP.height}`,
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
      entry.reject(new Error(message.error.message));
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
  await psend('Page.addScriptToEvaluateOnNewDocument', { source: PICKER_STAND_IN });
  if (FOOTER) {
    await psend('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.addEventListener('DOMContentLoaded', () => { ${FOOTER_INJECTION} });`,
    });
  }

  return {
    send: psend,
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
        throw new Error(`the page threw: ${thrown?.description ?? JSON.stringify(result.exceptionDetails).slice(0, 400)}`);
      }
      return result.result?.value;
    },
    async shot(name) {
      const { data } = await psend('Page.captureScreenshot', { format: 'png' });
      const path = resolve(OUT, name);
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    async setViewport({ width, height }, { touch = false } = {}) {
      await psend('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: touch,
      });
      await psend('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
      await delay(400);
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

/** Waits for a predicate over one evaluated expression, with a deadline that reports what it saw. */
async function waitFor(page, label, expression, predicate, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const read = await page.evaluate(expression);
    if (predicate(read)) {
      return read;
    }
    if (Date.now() >= deadline) {
      const shown = await page.evaluate('document.body.innerText.slice(0, 400)');
      throw new Error(
        `timed out after ${deadlineMs}ms waiting for ${label}; the page held ${JSON.stringify(read)} and showed ${JSON.stringify(shown)}`,
      );
    }
    await delay(150);
  }
}

/** What the in-room chrome is showing: the pieces a reviewer needs to see. */
const CHROME = `(() => {
  const visible = (id) => {
    const node = document.getElementById(id);
    return node !== null && node.hidden === false;
  };
  const text = (id) => document.getElementById(id)?.textContent ?? '';
  const leaf = (element) => element !== null && element.getClientRects().length > 0;
  const rows = [...document.querySelectorAll('#tree button.row')].map((row) => row.textContent.trim());
  const roster = [...document.querySelectorAll('#roster li')].map((row) => row.textContent.trim());
  const rect = (element) => {
    if (element === null) return null;
    const box = element.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), height: Math.round(box.height) };
  };
  const terms = document.getElementById('terms-link');
  return {
    sessionBar: visible('session'),
    workspace: visible('workspace'),
    newEntryRow: visible('new-entry'),
    copyControl: leaf(document.getElementById('share-group')),
    copyLabel: text('share-group') || document.querySelector('.share-label')?.textContent || '',
    leave: visible('leave') ? text('leave') : '',
    hostRow: roster.find((row) => /host/i.test(row)) ?? '',
    roster,
    treeRows: rows,
    newEntryButtons: [...document.querySelectorAll('#new-entry button')].map((button) => button.textContent.trim()),
    sessionNote: text('session-note'),
    editorText: [...document.querySelectorAll('.monaco-editor .view-line')].slice(0, 4).map((line) => line.textContent ?? '').join('\\n'),
    phonePanelOpen: document.getElementById('panel-toggle')?.getAttribute('aria-expanded') ?? null,
    termsLink: terms === null ? null : rect(terms),
    termsLinkInViewport: terms !== null && terms.getBoundingClientRect().bottom <= window.innerHeight && terms.getBoundingClientRect().top >= 0,
    footer: rect(document.getElementById('demo-footer')),
    joinCard: rect(document.getElementById('join')),
  };
})()`;

/**
 * The pre-join card on a phone with the demo footer: where the card sits, and whether the
 * footer's terms link is inside the viewport rather than under the fold.
 */
const PREJOIN = `(() => {
  const rect = (element) => {
    if (element === null) return null;
    const box = element.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), height: Math.round(box.height) };
  };
  const terms = document.getElementById('terms-link');
  const card = document.getElementById('join');
  const atTerms = terms === null ? null : document.elementFromPoint(terms.getBoundingClientRect().left + 4, terms.getBoundingClientRect().top + 8);
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    card: rect(card),
    footer: rect(document.getElementById('demo-footer')),
    termsLink: rect(terms),
    termsLinkInViewport: terms !== null && terms.getBoundingClientRect().bottom <= window.innerHeight,
    overTheTermsLink: atTerms === null ? null : atTerms.tagName + (atTerms.id === '' ? '' : '#' + atTerms.id),
    heading: document.getElementById('join-heading')?.textContent ?? '',
  };
})()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const page = await launchChromium();
  try {
    log('serving', server.origin, FOOTER ? 'with the demo footer' : 'without a footer');
    if (FOOTER) {
      // The finding this stands for: the reviewer's phone shot of a guest card, with the notice
      // the demo appends under the page. The card is read at 390x844 with touch emulation and
      // the footer measured against the viewport.
      const key = encodeKey(new Uint8Array(32).fill(9));
      await page.setViewport(PHONE, { touch: true });
      await page.navigate(`${server.origin}/?room=r-1&token=tok#k=${key}&h=${key}`);
      await waitFor(
        page,
        'the guest card',
        `document.getElementById('join-heading')?.hidden === false`,
        (shown) => shown === true,
      );
      await delay(400);
      const prejoin = await page.shot('03-prejoin-phone-with-footer.png');
      log('pre-join phone with the demo footer:', JSON.stringify(await page.evaluate(PREJOIN)));
      log('wrote', prejoin);
      await page.setViewport(DESKTOP);
    }
    await page.navigate(`${server.origin}/`);
    await waitFor(
      page,
      'the host card to offer the action',
      `(() => { const b = document.getElementById('host-button'); return b === null ? null : !b.hidden; })()`,
      (offered) => offered === true,
    );

    // The person's own act, made the way a person makes it: a name, then the button.
    await page.evaluate(`(() => {
      const name = document.getElementById('name');
      name.value = 'Ada';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('host-button').click();
      return document.getElementById('host-button').textContent;
    })()`);

    const hosted = await waitFor(
      page,
      'the room to seat this tab',
      `(() => { const bar = document.getElementById('session'); return bar === null ? null : !bar.hidden; })()`,
      (seated) => seated === true,
    );
    log('hosted; the session bar is up:', hosted);
    await waitFor(
      page,
      'the folder tree to be drawn',
      `document.querySelectorAll('#tree button.row').length`,
      (rows) => rows > 0,
    );

    // A file the editor shows, so the screenshot has the room's own text in it.
    const openedPath = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('#tree button.row')];
      const first = rows.find((row) => /README\\.md|notes\\.md/.test(row.textContent ?? '')) ?? rows[0];
      first.click();
      return first.textContent.trim();
    })()`);
    await page.evaluate(`(async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const lines = [...document.querySelectorAll('.monaco-editor .view-line')].map((line) => line.textContent ?? '');
        if (lines.some((line) => line.trim() !== '')) return lines.join('\\n');
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return '';
    })()`);
    await delay(500);

    const desktop = await page.shot('01-in-room-desktop.png');
    const desktopFacts = await page.evaluate(CHROME);
    log('desktop chrome:', JSON.stringify(desktopFacts));

    // The own-name edit, asked for the way a person asks: the self row's Rename. Two visible
    // ways out stand beside the field, so a person who does not know Enter can still act.
    await page.evaluate(`(() => {
      const row = document.querySelector('#roster li.self');
      const button = [...row.querySelectorAll('button')].find((candidate) => /Rename/.test(candidate.textContent ?? ''));
      button.click();
      return button.textContent;
    })()`);
    await waitFor(
      page,
      'the rename field and its two controls',
      `[document.querySelectorAll('#roster .rename').length, document.querySelectorAll('#roster .rename-save').length, document.querySelectorAll('#roster .rename-cancel').length].join(',')`,
      (counts) => counts === '1,1,1',
    );
    await delay(300);
    const renameShot = await page.shot('04-rename-field-open.png');
    log('wrote', renameShot);
    await page.evaluate(`(() => { document.querySelector('#roster .rename-cancel')?.click(); return true; })()`);
    await delay(200);

    // A second peer, the shape a guest has: the room's own link, the real engine, and one caret
    // in the file the page has open. It is what a follow follows, and the page's own follow bar
    // is the surface the status strip no longer repeats.
    const invite = await page.evaluate(`document.getElementById('share').title`);
    const guest = await PeerEngine.join({
      invite,
      displayName: 'Bob',
      webSocketFactory: nativeWebSocketFactory,
    });
    try {
      guest.setSelection(openedPath, { anchor: 0, head: 3 });
      await waitFor(
        page,
        'the second peer in the roster',
        `[...document.querySelectorAll('#roster li')].some((row) => /Bob/.test(row.textContent ?? ''))`,
        (there) => there === true,
      );
      await page.evaluate(`(() => {
        const row = [...document.querySelectorAll('#roster li')].find((candidate) => /Bob/.test(candidate.textContent ?? ''));
        const button = [...row.querySelectorAll('button')].find((candidate) => /Follow/.test(candidate.textContent ?? ''));
        button.click();
        return button.textContent;
      })()`);
      const followed = await waitFor(
        page,
        'the follow banner',
        `(() => {
          const banner = document.getElementById('follow-banner');
          return { hidden: banner === null ? null : banner.hidden, text: banner?.textContent ?? '', note: document.getElementById('session-note')?.textContent ?? '' };
        })()`,
        (state) => state.hidden === false && /Bob/.test(state.text),
      );
      log('following:', JSON.stringify(followed));
      await delay(400);
      const followShot = await page.shot('05-following-a-peer.png');
      log('wrote', followShot);
    } finally {
      await guest.disconnect();
    }

    // The pill under a held hover: the room key must stay blurred, because it belongs on the
    // clipboard rather than on a screen. The forced pseudo-state is the browser's own, so what
    // is measured is what a pointer would paint.
    await page.send('DOM.enable');
    await page.send('CSS.enable');
    const { root } = await page.send('DOM.getDocument');
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#share-group' });
    await page.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    const held = await page.evaluate(`(() => {
      const field = document.getElementById('share');
      const style = getComputedStyle(field);
      return { color: style.color, textShadow: style.textShadow, value: field.value };
    })()`);
    await delay(250);
    const holdShot = await page.shot('06-pill-under-hover.png');
    await page.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    log('the pill under a held hover (color, text-shadow):', JSON.stringify(held));
    log('wrote', holdShot);

    // The phone: the same room at 390x844 with touch emulation, and the panel opened so the
    // create-file row, the roster and the tree are in the shot rather than behind the disclosure.
    await page.setViewport(PHONE, { touch: true });
    await page.evaluate(`(() => {
      const toggle = document.getElementById('panel-toggle');
      if (toggle !== null && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
      return document.getElementById('panel-toggle')?.getAttribute('aria-expanded');
    })()`);
    await delay(600);
    const phone = await page.shot('02-in-room-phone.png');
    const phoneFacts = await page.evaluate(CHROME);
    log('phone chrome:', JSON.stringify(phoneFacts));

    const facts = { desktop: desktopFacts, phone: phoneFacts, footer: FOOTER };
    writeFileSync(resolve(OUT, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
    log('wrote', desktop);
    log('wrote', phone);
    log('wrote', resolve(OUT, 'facts.json'));
    if (FOOTER) {
      log(
        'the demo footer:',
        JSON.stringify(phoneFacts.footer),
        'terms link in the viewport:',
        phoneFacts.termsLinkInViewport,
      );
    }
  } finally {
    await page.stop();
    server.stop();
  }
}

await main();
