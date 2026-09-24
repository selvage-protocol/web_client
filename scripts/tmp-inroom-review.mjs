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

/**
 * The two devices this driver photographs, as the two things Chromium cannot emulate after launch.
 *
 * `(any-hover)` and `(any-pointer)` are decided from the browser's own pointing devices, and headless
 * Chromium has none: it answers `(any-hover: none)` on every page, whatever
 * `Emulation.setTouchEmulationEnabled` says (measured: `maxTouchPoints: 0` still leaves the query
 * answering `none`). So the *layout* — the 44 px targets, the touch-only lines, the phone's
 * disclosure — is a launch flag, and the two shapes need two browsers.
 * `Emulation.setDeviceMetricsOverride` gives each its viewport afterwards.
 */
const MOUSE_POINTER = [
  '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
];
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

/**
 * The smallest CDP driver this needs: one page, evaluate, screenshot, device metrics.
 *
 * `pointer` picks the device the whole browser reports: `mouse` is the desktop a real person with a
 * mouse gets, and `touch` is the phone. It is a launch argument and not an emulation call, because
 * that is the only place Chromium lets it be set.
 */
async function launchChromium({ pointer = 'mouse' } = {}) {
  // Chromium's scratch: the named base directory is a *base*, and only this script's own
  // subdirectory under it is ever removed, so an absolute `SELVAGE_CHROMIUM_TMPDIR` (or a shared
  // one) cannot have its other contents deleted. The default stays relative: Chromium puts its
  // process-singleton socket under `TMPDIR`, that path is bounded at about 108 bytes, and an
  // absolute path under a worktree is past it (`prove-host-version.mjs` carries the long form).
  const base = process.env['SELVAGE_CHROMIUM_TMPDIR'] ?? '.tmp';
  const tmp = `${base}/inroom-chromium-${pointer}`;
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
      ...(pointer === 'mouse' ? MOUSE_POINTER : []),
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
  /**
   * What the page logged: console messages and uncaught errors.
   *
   * A review that cannot see these cannot tell whether a screenshot is of a working page or of one
   * that threw on the way there, and "none today" is a fact worth recording rather than assuming.
   */
  const logged = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.method === 'Runtime.consoleAPICalled') {
      const { type, args } = message.params;
      logged.push(
        `${type}: ${args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')}`,
      );
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      logged.push(`pageerror: ${details.exception?.description ?? details.text}`);
      return;
    }
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
  // A headless page is not the focused document, and the clipboard API refuses a read from one
  // ("Document is not focused"). The driver copies the invite like a person does, so the page has to
  // be the focused one.
  await psend('Emulation.setFocusEmulationEnabled', { enabled: true });
  await psend('Page.addScriptToEvaluateOnNewDocument', { source: PICKER_STAND_IN });
  if (FOOTER) {
    await psend('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.addEventListener('DOMContentLoaded', () => { ${FOOTER_INJECTION} });`,
    });
  }

  return {
    send: psend,
    /** Everything the page logged since the browser started, newest last. */
    logged,
    async navigate(url) {
      await psend('Page.navigate', { url });
      await psend('Page.bringToFront');
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
      // `maxTouchPoints` decides `(any-hover)`/`(any-pointer)` for the whole page, and it is applied
      // whether or not the emulation is on: passing 5 with `enabled: false` left the page reporting
      // `(any-hover: none)`, which is the touch layout — the 44 px targets and the phone-only lines
      // — and it is what every earlier shot here photographed. A desktop shot turns touch off and
      // says no touch points at all, so the page answers with the mouse layout a real person gets.
      // Off is `{ enabled: false }` and nothing else: the protocol refuses a touch-point count of
      // zero, and omitting the field is what leaves the device with no touch at all.
      await psend(
        'Emulation.setTouchEmulationEnabled',
        touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
      );
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

/**
 * The invite the room is sharing, taken the way a person takes it: press the control, read the
 * clipboard. The readout itself is deliberately not readable — it holds a mask and no attribute
 * holds the link — so a driver that needs the link has to copy it like anybody else.
 */
async function copyInvite(page, origin) {
  await page.send('Browser.grantPermissions', {
    origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });
  const read = await page.evaluate(
    `(async () => {
      const state = { value: '', why: '' };
      if (navigator.clipboard === undefined) {
        return { ...state, why: 'no navigator.clipboard in this page' };
      }
      document.getElementById('share-group').click();
      for (let tries = 0; tries < 40; tries += 1) {
        try {
          const text = await navigator.clipboard.readText();
          if (text !== '') return { ...state, value: text };
          state.why = 'the clipboard is empty';
        } catch (error) {
          state.why = String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      state.value = document.getElementById('share').value;
      return state;
    })()`,
  );
  if (read.value === '' || read.value.includes('•')) {
    throw new Error(`the copy control put no invite on the clipboard: ${read.why}`);
  }
  return read.value;
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
  const share = document.getElementById('share');
  const shareStyle = share === null ? null : getComputedStyle(share);
  return {
    // What the layout was decided from. (any-hover: none) is the touch layout — 44 px targets and
    // the phone-only lines — so recording this is what keeps a shot from being read as a desktop
    // one it never was; maxTouchPoints is what decides it for a real Chromium.
    environment: {
      anyHover: matchMedia('(any-hover: hover)').matches,
      anyHoverNone: matchMedia('(any-hover: none)').matches,
      anyPointerFine: matchMedia('(any-pointer: fine)').matches,
      maxTouchPoints: navigator.maxTouchPoints,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
    },
    // What the copy control carries, and what a pointer could read off it: the value is bullets and
    // no attribute holds the link, so a tooltip cannot show the room key.
    shareReadout: share === null ? null : {
      value: share.value,
      title: share.getAttribute('title'),
      attributes: [...share.attributes].map((attribute) => attribute.name),
      groupTitle: document.getElementById('share-group')?.getAttribute('title') ?? null,
      color: shareStyle?.color ?? null,
      textShadow: shareStyle?.textShadow ?? null,
    },
    sessionBar: visible('session'),
    workspace: visible('workspace'),
    copyControl: leaf(document.getElementById('share-group')),
    copyLabel: text('share-group') || document.querySelector('.share-label')?.textContent || '',
    leave: visible('leave') ? text('leave') : '',
    // The bar's own facts: which session it is, and what the health dot is saying.
    sessionIdentity: text('session-identity'),
    health: document.getElementById('health')?.dataset.health ?? null,
    healthLabel: text('health-label'),
    // The panel's own edge, and whether it is drawn at all on this device.
    resizer: rect(document.getElementById('side-resizer')),
    resizerCollapsed: document.getElementById('side-resizer')?.dataset.collapsed ?? null,
    sideWidth: Math.round(document.getElementById('side')?.getBoundingClientRect().width ?? 0),
    // The file strip: the open file's whole state in one line. innerText collapses the shell's own
    // indentation, which textContent would report as the line's content.
    fileStrip: document.getElementById('file-strip')?.innerText ?? '',
    fileStripChips: document.getElementById('file-strip-chips')?.innerText ?? '',
    fileStripFollow: document.getElementById('file-strip-follow')?.innerText ?? '',
    hostRow: roster.find((row) => /host/i.test(row)) ?? '',
    roster,
    treeRows: rows,
    createRow: document.querySelectorAll('#tree .new-row').length,
    localFolders: [...document.querySelectorAll('#tree .local')].map((tag) => tag.textContent),
    inRoomDots: document.querySelectorAll('#tree .in-room').length,
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

/** What a guest's own page shows about the file it is about to save. */
const GUEST_ROWS = `(() => {
  const rows = [...document.querySelectorAll('#tree button.row')].map((row) => ({
    text: (row.textContent ?? '').trim(),
    inRoom: row.querySelector('.in-room') !== null,
    emptyTag: row.querySelector('.empty-tag') !== null,
    download: row.querySelector('.download') !== null,
  }));
  const strip = document.getElementById('file-strip')?.innerText ?? '';
  return { rows, strip };
})()`;

/**
 * One row's own inline line, which is where a fetch says what it is doing and what it cost.
 *
 * The controls are read with the sentence because the sentence alone does not name the state: a
 * fetch the room has not answered and a fetch that answered with an empty document are told apart
 * by what the line offers — `Save empty file` is a fact about the room's answer and is there only
 * for the second — and a run that recorded only the words could not say which it photographed.
 */
const ROW_NOTE = `(() => {
  const note = document.querySelector('#tree .row-note');
  if (note === null) return null;
  const controls = note.querySelectorAll('button');
  return {
    text: (note.textContent ?? '').trim(),
    actions: [...controls].map((button) => (button.textContent ?? '').trim()),
  };
})()`;

/**
 * Which of the fetch's states a row's line is in, from the line itself.
 *
 * `pending` is the room not having answered — the text may still arrive, and no run may call that
 * empty; `empty` is the room's own answer that its document for the path holds no text, which is
 * the only state that offers to save an empty file; `other` is the cost line or a failure.
 */
function noteState(note) {
  if (note === null) {
    return 'none';
  }
  const actions = note.actions.join(' ');
  if (/Save empty file/.test(actions)) {
    return 'empty';
  }
  if (/no answer yet/.test(note.text)) {
    return 'pending';
  }
  return 'other';
}

/** A fetch's state once the line is not the cost of opening it, which stands five seconds. */
function settledState(note) {
  const state = noteState(note);
  return state === 'other' && /Fetching opens/.test(note.text) ? 'none' : state;
}

/**
 * Hosts a room in the page the way a person does — a name, then the button the picker answers — and
 * opens the first file that reads like the project's README. Returns the path it opened.
 */
async function hostAndOpen(page, server) {
  await page.navigate(`${server.origin}/`);
  await waitFor(
    page,
    'the host card to offer the action',
    `(() => { const b = document.getElementById('host-button'); return b === null ? null : !b.hidden; })()`,
    (offered) => offered === true,
  );
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
  const openedPath = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#tree button.row')];
    const first = rows.find((row) => /README[.]md|notes[.]md/.test(row.textContent ?? '')) ?? rows[0];
    first.click();
    return first.textContent.trim();
  })()`);
  await waitFor(
    page,
    'the file in the editor',
    `[...document.querySelectorAll('.monaco-editor .view-line')].some((line) => (line.textContent ?? '').trim() !== '')`,
    (there) => there === true,
  );
  return openedPath;
}

/** The desktop shots, in the mouse browser: the layout a real pointer gets, and every new control. */
async function reviewDesktop(page, server, written) {
  const openedPath = await hostAndOpen(page, server);
  const chrome = await page.evaluate(CHROME);
  log('desktop chrome:', JSON.stringify(chrome));
  log('wrote', await record(written, page, '01-in-room-desktop.png'));
  const facts = { chrome };

  // The create row, refused and previewed. Two states of the same line: a name this room cannot
  // share, and a path that will make its own folders.
  await page.evaluate(`document.getElementById('new-file').click()`);
  await waitFor(
    page,
    'the create row',
    `document.querySelectorAll('#tree .new-name').length`,
    (rows) => rows === 1,
  );
  await page.evaluate(`(() => {
    const field = document.querySelector('#tree .new-name');
    field.value = '.env';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(
    page,
    'the live refusal',
    `document.querySelector('#tree .new-name')?.classList.contains('invalid')`,
    (invalid) => invalid === true,
  );
  await delay(250);
  facts.createRefusal = await page.evaluate(
    `document.querySelector('#tree .new-hint')?.textContent ?? ''`,
  );
  log('create row, refused live:', JSON.stringify(facts.createRefusal));
  log('wrote', await record(written, page, '07-create-row-refused.png'));

  await page.evaluate(`(() => {
    const field = document.querySelector('#tree .new-name');
    field.value = 'docs/intro.md';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await delay(300);
  facts.createPreview = await page.evaluate(
    `document.querySelector('#tree .new-hint')?.textContent ?? ''`,
  );
  log('create row, a path that makes its folders:', JSON.stringify(facts.createPreview));
  log('wrote', await record(written, page, '08-create-row-makes-folders.png'));

  // The file strip, with the file the strip is about. Cropped to the strip as well as framed, so a
  // reviewer can read the one line without hunting for it in a 1280 px page.
  facts.fileStrip = await page.evaluate(`document.getElementById('file-strip')?.textContent ?? ''`);
  log('file strip:', JSON.stringify(facts.fileStrip));
  log('wrote', await record(written, page, '09-file-strip.png'));
  const stripShot = await page.shot('09b-file-strip-only.png');
  written.push('09b-file-strip-only.png');
  log('wrote the strip alone:', stripShot);

  // Cancel the create row before the rest, so nothing else photographs it.
  await page.evaluate(`document.querySelector('#tree .new-cancel')?.click()`);

  // The own-name edit, asked for the way a person asks: the self row's Rename.
  await page.evaluate(`(() => {
    const row = document.querySelector('#roster li.self');
    // The own row's one control. Its label is a word and its aria-label is the sentence a screen
    // reader reads, so it is found by its own text.
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
  log('wrote', await record(written, page, '04-rename-field-open.png'));
  await page.evaluate(`document.querySelector('#roster .rename-cancel')?.click()`);
  await delay(200);

  // A second peer, the shape a guest has: the real engine over the real wire, one caret in the file
  // the page has open, and a follow to watch the strip's follow segment.
  const invite = await copyInvite(page, server.origin);
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
      'the follow segment in the file strip',
      `document.getElementById('file-strip-follow')?.innerText ?? ''`,
      (text) => /Bob/.test(text),
    );
    facts.followSegment = followed;
    log('following:', JSON.stringify(followed));
    await delay(400);
    log('wrote', await record(written, page, '05-following-a-peer.png'));
  } finally {
    await guest.disconnect();
  }

  // The pill under a held hover, and what a pointer could read off it: the room key must not be
  // readable from any of it.
  await page.send('DOM.enable');
  await page.send('CSS.enable');
  const { root } = await page.send('DOM.getDocument');
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#share-group' });
  await page.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
  facts.pillUnderHover = await page.evaluate(`(() => {
    const field = document.getElementById('share');
    const style = getComputedStyle(field);
    return {
      value: field.value,
      title: field.getAttribute('title'),
      attributes: [...field.attributes].map((attribute) => attribute.name),
      color: style.color,
      textShadow: style.textShadow,
    };
  })()`);
  await delay(250);
  log('wrote', await record(written, page, '06-pill-under-hover.png'));
  await page.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
  log('the pill under a held hover:', JSON.stringify(facts.pillUnderHover));

  // The sidebar, mid-drag: the separator is pressed and the pointer has moved 80 px right, which is
  // the state the highlight and the col-resize cursor belong to.
  const separator = await page.evaluate(`(() => {
    const box = document.getElementById('side-resizer').getBoundingClientRect();
    return { x: Math.round(box.left + box.width / 2), y: Math.round(window.innerHeight / 2) };
  })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: separator.x, y: separator.y });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: separator.x,
    y: separator.y,
    button: 'left',
    clickCount: 1,
  });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: separator.x + 80,
    y: separator.y,
    button: 'left',
  });
  await delay(300);
  facts.sidebarMidDrag = await page.evaluate(`(() => {
    const side = document.getElementById('side');
    const separator = document.getElementById('side-resizer');
    return {
      width: Math.round(side.getBoundingClientRect().width),
      dragging: separator.dataset.dragging ?? null,
      valuenow: separator.getAttribute('aria-valuenow'),
      cursor: getComputedStyle(separator).cursor,
      stored: window.localStorage.getItem('selvage.sidebar'),
    };
  })()`);
  log('the sidebar mid-drag:', JSON.stringify(facts.sidebarMidDrag));
  log('wrote', await record(written, page, '10-sidebar-mid-drag.png'));
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: separator.x + 80,
    y: separator.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(200);
  facts.sidebarAfterDrag = await page.evaluate(`(() => {
    const separator = document.getElementById('side-resizer');
    return {
      width: Math.round(document.getElementById('side').getBoundingClientRect().width),
      valuenow: separator.getAttribute('aria-valuenow'),
      valuetext: separator.getAttribute('aria-valuetext'),
    };
  })()`);
  log('the sidebar after the drag:', JSON.stringify(facts.sidebarAfterDrag));
  return { facts, invite };
}

/** The touch shots, in the touch browser: the phone's layout, and a guest fetching a file to save. */
async function reviewTouch(page, server, invite, written, ...hostPages) {
  const facts = {};
  if (FOOTER) {
    // The finding this stands for: the reviewer's phone shot of a guest card, with the notice the
    // demo appends under the page. A whole invite that names no room shows the card without joining.
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
    facts.prejoin = await page.evaluate(PREJOIN);
    log('pre-join phone with the demo footer:', JSON.stringify(facts.prejoin));
    log('wrote', await record(written, page, '03-prejoin-phone-with-footer.png'));
  }

  // The guest itself: the invite the host page copied, opened on a touch device. The panel is shut
  // there and the strip is the only thing on screen that says which file is open.
  await page.setViewport(PHONE, { touch: true });
  await page.navigate(invite);
  // A guest's own act, made the way a guest makes it: an invite in the address bar opens the invite
  // path, and the name and Join are still the person's.
  await waitFor(
    page,
    'the join card with the invite in the address bar',
    `(() => { const b = document.getElementById('join-button'); return b === null ? null : b.hidden === false; })()`,
    (offered) => offered === true,
  );
  await page.evaluate(`(() => {
    const name = document.getElementById('name');
    name.value = 'Guest';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('join-button').click();
    return true;
  })()`);
  await waitFor(
    page,
    'the guest to be seated',
    `(() => { const bar = document.getElementById('session'); return bar === null ? null : !bar.hidden; })()`,
    (seated) => seated === true,
  );
  await waitFor(
    page,
    'the shared files',
    `document.querySelectorAll('#tree button.row').length`,
    (rows) => rows > 0,
  );
  await delay(500);
  facts.settled = await page.evaluate(GUEST_ROWS);
  log('the guest, at rest:', JSON.stringify(facts.settled));
  log('wrote', await record(written, page, '02-in-room-phone.png'));

  // Every directory open, so the row the fetch is about is on screen: a note inside a collapsed
  // folder is a note nobody can see.
  await page.evaluate(`(() => {
    for (const details of document.querySelectorAll('#tree details')) {
      if (details.open === false) details.querySelector('summary').click();
    }
    return true;
  })()`);
  await delay(300);

  // A file whose text has not been fetched, saved from its own row. The row's action is visible
  // without hover — the whole point — and the fetch is what opens the file for everyone.
  const target = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('#tree button.row')].find((candidate) => {
      const button = candidate.querySelector('.download');
      return button !== null && candidate.querySelector('.in-room') === null;
    });
    if (row === undefined) return null;
    const button = row.querySelector('.download');
    const path = (button.getAttribute('aria-label') ?? '').replace(/^Download /, '');
    button.click();
    return path;
  })()`);
  facts.downloadTarget = target;
  log('a file with no text here, saved from its row:', JSON.stringify(target));
  if (target === null) {
    throw new Error('no row offered a download: nothing to photograph');
  }
  await waitFor(
    page,
    'the row to say what the fetch costs',
    ROW_NOTE,
    (note) => note !== null && /Fetching opens/.test(note.text),
  );
  facts.fetchNote = await page.evaluate(ROW_NOTE);
  facts.fetchBusy = await page.evaluate(
    `document.querySelector('#tree .row-actions.busy')?.getAttribute('aria-label') ?? null`,
  );
  log('the fetch, in the row it is about:', JSON.stringify(facts.fetchNote), facts.fetchBusy);
  log('wrote', await record(written, page, '11-download-unfetched-phone.png'));

  // Where it ended. The row gains `●` when the text lands — the fetch is what put it in the room —
  // and a fetch the host did not answer says the wait is still running and offers the person trying
  // again. What that line *offers* is what tells a room that answered with an empty document from a
  // room that has said nothing: the first offers to save an empty file and the second does not, and
  // a run that recorded only the words could not say which of the two it saw.
  // The path the driver clicked, and no other: a fetch of `notes.md` is not a fetch of `main.ts`.
  const landed = async () =>
    (await page.evaluate(
      `(() => {
        const wanted = ${JSON.stringify(target)};
        const leaf = wanted.slice(wanted.lastIndexOf('/') + 1);
        const row = [...document.querySelectorAll('#tree button.row')].find((candidate) =>
          [...candidate.querySelectorAll('span.label')].some((span) => span.textContent === leaf),
        );
        return row !== undefined && row.querySelector('.in-room') !== null;
      })()`,
    )) === true;
  let outcome = { landed: false, note: null, state: 'none' };
  const states = [];
  for (let tick = 0; tick < 160 && !outcome.landed; tick += 1) {
    const note = await page.evaluate(ROW_NOTE);
    const state = settledState(note);
    outcome = { landed: await landed(), note, state };
    if (states[states.length - 1] !== state) states.push(state);
    if (state === 'empty' || state === 'pending') break;
    await delay(250);
  }
  facts.fetchStates = states;
  facts.fetchOutcome = outcome;
  if (!outcome.landed) {
    // The row's own answer to a fetch that did not land, and the design's: not a bare failure, but a
    // sentence and the things a person can do about it. `Save empty file` is only one of them where
    // the room answered with an empty document; where it has answered nothing at all the line says
    // the wait is still running and never claims the file is empty.
    facts.fetchRetried = true;
    log(
      'the first fetch did not land; the row said',
      JSON.stringify(outcome.state),
      'and offers',
      JSON.stringify(outcome.note === null ? [] : outcome.note.actions),
      '— trying again, which is what the row itself offers',
    );
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('#tree .row-note button')].find((candidate) => /Try again/.test(candidate.textContent ?? ''));
      button?.click();
      return true;
    })()`);
    for (let tick = 0; tick < 160 && !outcome.landed; tick += 1) {
      const note = await page.evaluate(ROW_NOTE);
      const state = settledState(note);
      outcome = { landed: await landed(), note, state };
      if (states[states.length - 1] !== state) states.push(state);
      if (state === 'empty' || state === 'pending') break;
      await delay(250);
    }
    facts.fetchStates = states;
    facts.fetchOutcome = outcome;
  }
  facts.afterFetch = await page.evaluate(GUEST_ROWS);
  log('the guest, after the fetch:', JSON.stringify({ landed: outcome.landed, ...facts.afterFetch }));
  if (!outcome.landed) {
    // Not a failure of the driver: this is the state a person meets when the host does not answer,
    // and it is worth photographing for that reason alone. What the host's own page thought of the
    // guest's hold is recorded beside it, because that is the evidence for why the text never came.
    facts.fetchNeverLanded = true;
    log(
      'the fetch did not land; the room still reads:',
      JSON.stringify(facts.afterFetch.rows),
      'and the host page read:',
      JSON.stringify(await arguments[4].evaluate(
        `[...document.querySelectorAll('#tree button.row')].map((row) => (row.textContent ?? '').trim() + (row.querySelector('.in-room') === null ? '' : '[text in the room]'))`,
      )),
    );
  }
  // The panel is where the row's own line lives, and opening README.md shut it: a shot of a row has
  // to be a shot of the panel.
  await page.evaluate(`(() => {
    if (document.getElementById('side').hidden) document.getElementById('panel-toggle').click();
    for (const details of document.querySelectorAll('#tree details')) {
      if (details.open === false) details.querySelector('summary').click();
    }
    return true;
  })()`);
  await delay(500);
  log('wrote', await record(written, page, '12-download-not-answered-phone.png'));
  return facts;
}

/** Takes one shot and records the name, in the order the shots were taken. */
async function record(written, page, name) {
  written.push(name);
  return page.shot(name);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const written = [];
  const facts = { footer: FOOTER, shots: written, console: [] };
  log('serving', server.origin, FOOTER ? 'with the demo footer' : 'without a footer');
  const browsers = [];
  try {
    const mouse = await launchChromium({ pointer: 'mouse' });
    browsers.push({ name: 'desktop', page: mouse });
    await mouse.setViewport(DESKTOP);
    const desktop = await reviewDesktop(mouse, server, written);
    facts.desktop = desktop.facts;
    const touch = await launchChromium({ pointer: 'touch' });
    browsers.push({ name: 'phone', page: touch });
    facts.phone = await reviewTouch(touch, server, desktop.invite, written, mouse);
  } finally {
    // Whatever happened — a `waitFor` that timed out, a browser that would not launch, the guest's
    // clipboard refusing — both browsers and the server are stopped and their logs collected. A
    // failure that left a Chromium and a `selvaged` behind, with a CDP socket still open, is a driver
    // that hangs after the error instead of exiting.
    for (const { name, page: browser } of browsers) {
      facts.console.push(...browser.logged.map((line) => `${name} ${line}`));
      await browser.stop();
    }
    server.stop();
  }
  writeFileSync(resolve(OUT, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  log('wrote', resolve(OUT, 'facts.json'));
  log('console and page errors:', facts.console.length === 0 ? 'none' : JSON.stringify(facts.console));
  if (FOOTER) {
    log(
      'the demo footer:',
      JSON.stringify(facts.phone.prejoin?.footer),
      'terms link in the viewport:',
      facts.phone.prejoin?.termsLinkInViewport,
    );
  }
}

await main();
