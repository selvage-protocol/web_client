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
 * page, so the phone shot shows whether it is reachable without hunting, and the last run of the
 * empty room measures the same notice once a session is on screen.
 *
 * The last pass photographs the room's two empty states, which need a folder with nothing in it:
 * the driver leaves the room it built, starts another from an empty folder and joins it as a
 * guest (`13-editor-empty-host.png`, `14-editor-empty-guest.png`).
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
 *
 * `window.__selvageEmptyFolder` is the driver's own flag for the second room it starts: a folder
 * with nothing in it is the one state where the editor pane has no file to show, and a seeded
 * folder could never produce it.
 */
const SEED = {
  'README.md':
    '# Hosted from the browser\n\nEvery file here is the room, and its text arrives when somebody opens it.\n',
  'notes.md': '# Room notes\n\n- one host, any number of guests\n',
  'src/main.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
};

const PICKER_STAND_IN = `(() => {
  const SEED = ${JSON.stringify(SEED)};
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
    const seed = window.__selvageEmptyFolder === true ? {} : SEED;
    for (const [path, text] of Object.entries(seed)) {
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
    async shot(name, clip) {
      // A clip crops the shot to the control the run is about, so a reviewer reads the chrome
      // rather than hunting for it in a 1280 px page.
      const { data } = await psend(
        'Page.captureScreenshot',
        clip === undefined ? { format: 'png' } : { format: 'png', clip },
      );
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
  const rect = (element) => {
    if (element === null) return null;
    const box = element.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width), height: Math.round(box.height) };
  };
  const terms = document.getElementById('terms-link');
  const health = document.getElementById('health');
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
    // The bar's own facts: which session it is, and whether a health state is painted at all — a
    // healthy room draws nothing, so this is null on a room that is fine.
    sessionIdentity: text('session-identity'),
    health: health?.dataset.health ?? null,
    healthLabel: text('health-label'),
    healthPainted: health !== null && getComputedStyle(health).display !== 'none',
    // The panel's own edge, and whether it is drawn at all on this device.
    resizer: rect(document.getElementById('side-resizer')),
    resizerCollapsed: document.getElementById('side-resizer')?.dataset.collapsed ?? null,
    sideWidth: Math.round(document.getElementById('side')?.getBoundingClientRect().width ?? 0),
    // The file strip: the open file, and nothing else — the directory muted, the leaf bold.
    fileStrip: document.getElementById('file-strip')?.innerText ?? '',
    fileStripIds: [...(document.getElementById('file-strip')?.querySelectorAll('[id]') ?? [])].map((node) => node.id),
    treeRows: rows,
    createRow: document.querySelectorAll('#tree .new-row').length,
    // The panel's own footer bar, and the words on its two verbs.
    treeActions: document.getElementById('tree-actions')?.hidden === false
      ? [...document.querySelectorAll('#tree-actions button')].map((button) => button.textContent ?? '')
      : [],
    // The folder rows: the glyphs they wear, the name they carry, and the badges of the peers inside.
    folders: [...document.querySelectorAll('#tree details[data-dir] > summary')].map((summary) => ({
      name: summary.querySelector('.label')?.textContent ?? '',
      icons: [...summary.querySelectorAll('.icon.folder')].map((icon) => icon.className),
      chevron: summary.querySelector('.chev') !== null,
      badges: [...summary.querySelectorAll('.presence .badge')].map((badge) => badge.title),
      open: summary.parentElement?.open === true,
    })),
    // No row states anything about the room any more: the tags and the refused-write mark are gone.
    rowTags: document.querySelectorAll('#tree .empty-tag, #tree .pending-tag, #tree .unsaved').length,
    rowMarks: [...document.querySelectorAll('#tree .label')].map((label) => label.textContent ?? ''),
    rowHeights: [...document.querySelectorAll('#tree li')].slice(0, 6).map((row) => Math.round(row.getBoundingClientRect().height * 10) / 10),
    leaveBox: rect(document.getElementById('leave')),
    barBox: rect(document.getElementById('session')),
    barText: rect(document.getElementById('brand')),
    stripBox: rect(document.getElementById('file-strip')),
    stripText: rect(document.getElementById('file-strip-path')),
    sideBox: rect(document.getElementById('side')),
    treeBox: rect(document.getElementById('tree')),
    treeActionsBox: rect(document.getElementById('tree-actions')),
    sessionNote: text('session-note'),
    editorText: [...document.querySelectorAll('.monaco-editor .view-line')].slice(0, 4).map((line) => line.textContent ?? '').join('\\n'),
    phonePanelOpen: document.getElementById('side')?.hidden !== true,
    termsLink: terms === null ? null : rect(terms),
    termsLinkInViewport: terms !== null && terms.getBoundingClientRect().bottom <= window.innerHeight && terms.getBoundingClientRect().top >= 0,
    footer: rect(document.getElementById('demo-footer')),
    joinCard: rect(document.getElementById('join')),
  };
})()`;

/**
 * The faces in the session bar: what each one is read by, which marks it wears, and the size it is
 * actually drawn at. The label and the title are the two readings a person has — one for a screen
 * reader and one for a pointer — and the crown and the eye are pictures, so they are counted rather
 * than read.
 */
const FACES = `(() => {
  const faces = [...document.querySelectorAll('#faces .av')].map((face) => {
    const box = face.getBoundingClientRect();
    return {
      label: face.getAttribute('aria-label') ?? '',
      title: face.getAttribute('title') ?? '',
      classes: face.className,
      crown: face.querySelector('.crown') !== null,
      eye: face.querySelector('.eye') !== null,
      expanded: face.getAttribute('aria-expanded'),
      size: Math.round(box.width) + 'x' + Math.round(box.height),
    };
  });
  const bar = document.getElementById('session');
  const strip = document.getElementById('file-strip');
  return {
    faces,
    group: document.getElementById('faces')?.getAttribute('aria-label') ?? '',
    barHeight: Math.round(bar.getBoundingClientRect().height),
    chromeHeight: Math.round(bar.getBoundingClientRect().height + strip.getBoundingClientRect().height),
  };
})()`;

/**
 * What the cluster costs the bar, measured the only way it can be: the same bar with the cluster
 * hidden. The design's number is 0 px on a phone, and a bar that grew would be a bar that took a
 * line from the editor for a row of faces.
 *
 * The face's own box is 34 px there, and its hit area is not its box: the target is 44 px tall from
 * the 5 px laid above and below it — not to the sides, where the overlapping circles would take a
 * neighbour's edge — so the readings that say so are what a point 3 px above and 3 px beside the
 * edge land on.
 */
const BAR_COST = `(() => {
  const bar = document.getElementById('session');
  const faces = document.getElementById('faces');
  const strip = document.getElementById('file-strip');
  const withFaces = bar.getBoundingClientRect().height;
  const chrome = withFaces + strip.getBoundingClientRect().height;
  const display = faces.style.display;
  faces.style.display = 'none';
  const withoutFaces = bar.getBoundingClientRect().height;
  faces.style.display = display;
  const face = document.querySelector('#faces .av');
  const box = face === null ? null : face.getBoundingClientRect();
  const at = (x, y) => {
    const node = document.elementFromPoint(x, y);
    if (node === null) return null;
    return (node.className === '' ? node.tagName : String(node.className)).toString();
  };
  const identity = document.getElementById('session-identity');
  const truncated = () => identity !== null && identity.scrollWidth > identity.clientWidth + 1;
  const identityTruncatedWithFaces = truncated();
  const identityWithFaces = identity === null ? null : { width: Math.round(identity.clientWidth), needs: Math.round(identity.scrollWidth) };
  faces.style.display = 'none';
  const identityTruncatedWithoutFaces = truncated();
  const identityWithoutFaces = identity === null ? null : { width: Math.round(identity.clientWidth), needs: Math.round(identity.scrollWidth) };
  faces.style.display = display;
  return {
    identityTruncatedWithFaces,
    identityTruncatedWithoutFaces,
    identityWithFaces,
    identityWithoutFaces,
    barWithFaces: Math.round(withFaces),
    barWithoutFaces: Math.round(withoutFaces),
    added: Math.round(withFaces - withoutFaces),
    chrome: Math.round(chrome),
    barAfterRestore: Math.round(bar.getBoundingClientRect().height),
    face: box === null ? null : { width: Math.round(box.width), height: Math.round(box.height) },
    // Where the fingertip's 44 px comes from: a point outside the circle that still lands on it.
    hitAbove: box === null ? null : at(Math.round(box.left + box.width / 2), Math.round(box.top - 3)),
    hitLeft: box === null ? null : at(Math.round(box.left - 3), Math.round(box.top + box.height / 2)),
  };
})()`;

/**
 * Where focus is: on a face (its peer anchor), on a control in the dialog, or nowhere (the body).
 * A redraw that replaces the focused element leaves `#faces` with nothing in focus, which is the
 * body — the state three findings were about.
 */
const FOCUS = `(() => {
  const active = document.activeElement;
  const faces = document.getElementById('faces');
  const menu = document.getElementById('menu');
  return {
    tag: active === null ? 'none' : active.tagName,
    anchor: active?.getAttribute?.('data-anchor') ?? null,
    label: active?.getAttribute?.('aria-label') ?? null,
    onAFace: active !== null && faces !== null && faces.contains(active),
    inTheMenu: active !== null && menu !== null && menu.contains(active),
    onTheBody: active === document.body,
  };
})()`;

/**
 * The tap area a phone face actually gets: the columns of the neighbour beside your own seat that
 * land on that neighbour, on the bar, or on a face that has no business taking the tap. A face's
 * box is 34 px; the design's circles overlap, so what matters is how much of that box answers for
 * the face rather than for the one it overlaps.
 */
const TAP_WIDTH = `(() => {
  const faces = [...document.querySelectorAll('#faces .av')];
  const own = faces.find((face) => face.classList.contains('me')) ?? faces[0];
  const peer = faces[faces.indexOf(own) + 1];
  if (peer === undefined) return null;
  const box = peer.getBoundingClientRect();
  const y = Math.round(box.top + box.height / 2);
  const owner = new Map();
  for (let x = Math.round(box.left); x < Math.round(box.right); x += 1) {
    const at = document.elementFromPoint(x, y);
    const face = at === null ? null : at.closest('#faces .av');
    let key = 'none';
    if (face === peer) key = 'peer';
    else if (face === own) key = 'own';
    else if (face !== null && face.classList.contains('more')) key = 'more';
    else if (face !== null) key = 'other';
    owner.set(key, (owner.get(key) ?? 0) + 1);
  }
  return { width: Math.round(box.width), columns: Math.round(box.width), ...Object.fromEntries(owner) };
})()`;

/** The way out on a phone: its box, and the words it still carries out of the paint. */
const LEAVE = `(() => {
  const button = document.getElementById('leave');
  if (button === null) return null;
  const box = button.getBoundingClientRect();
  const label = button.querySelector('.label');
  const icon = button.querySelector('.icon');
  return {
    text: button.textContent,
    ariaLabel: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
    width: Math.round(box.width),
    height: Math.round(box.height),
    iconDrawn: icon !== null && getComputedStyle(icon).display !== 'none',
    labelInTheDom: label !== null,
    labelClipped: label !== null && getComputedStyle(label).position === 'absolute',
  };
})()`;

/**
 * The open dialog: what it is read by, what it says about the person, the acts it offers, and where
 * it stands against the face it came from.
 */
const MENU = `(() => {
  const menu = document.getElementById('menu');
  if (menu === null) return null;
  const box = menu.getBoundingClientRect();
  const anchor = document.querySelector('#faces [aria-expanded="true"]');
  const at = anchor === null ? null : anchor.getBoundingClientRect();
  const active = document.activeElement;
  return {
    label: menu.getAttribute('aria-label'),
    role: menu.getAttribute('role'),
    head: (menu.querySelector('.head')?.innerText ?? '').trim(),
    where: (menu.querySelector('.where')?.textContent ?? '').trim(),
    acts: [...menu.querySelectorAll('.acts button')].map((button) => ({
      text: (button.textContent ?? '').trim(),
      pressed: button.getAttribute('aria-pressed'),
      title: button.getAttribute('title'),
      disabled: button.disabled,
    })),
    waiting: (menu.querySelector('.waiting')?.textContent ?? '').trim(),
    refusal: (menu.querySelector('.refusal')?.textContent ?? '').trim(),
    back: (menu.querySelector('.back')?.textContent ?? '').trim(),
    rows: [...menu.querySelectorAll('.list button')].map((row) => row.getAttribute('aria-label')),
    focus:
      active === null || active === document.body
        ? null
        : (active.getAttribute('aria-label') ?? (active.textContent ?? '').trim()).slice(0, 40) || active.tagName,
    placement: {
      gapUnderTheFace: at === null ? null : Math.round(box.top - at.bottom),
      rightEdgeOnTheFace: at === null ? null : Math.round(box.right) === Math.round(at.right),
      insideTheFrame: box.left >= 0 && box.right <= window.innerWidth,
    },
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
    // The guest card's other intent, as the one quiet line it is worth there: hosting is not what
    // this person came for, and the paragraph about whose tab this is waits on the start card the
    // line opens. A hidden start button beside it is what makes the line the only act.
    quietLine: document.getElementById('host-quiet')?.textContent ?? '',
    quietLineVisible: document.getElementById('host-quiet')?.hidden === false,
    startButtonVisible: document.getElementById('host-button')?.hidden === false,
    hostNote: document.getElementById('host-note')?.textContent ?? '',
  };
})()`;

/** The editor pane with no document in it: what it says, and what it offers to do about it. */
const EMPTY_PANE = `(() => {
  const pane = document.getElementById('editor-empty');
  if (pane === null || pane.hidden) return null;
  const blocks = [...pane.querySelectorAll('.empty-block')].map((block) => ({
    lead: block.querySelector('.empty-lead')?.textContent ?? '',
    text: block.querySelector('.empty-text')?.textContent ?? '',
    actions: [...block.querySelectorAll('.empty-actions button')].map((button) => (button.textContent ?? '').trim()),
  }));
  const box = pane.getBoundingClientRect();
  return {
    blocks,
    size: Math.round(box.width) + 'x' + Math.round(box.height),
    stripPath: document.getElementById('file-strip-path')?.innerText ?? '',
    strip: document.getElementById('file-strip')?.innerText ?? '',
    treeEmpty: document.querySelector('#tree .empty')?.textContent ?? '',
    panelOpen: document.getElementById('side')?.hidden === false,
  };
})()`;
/** What a guest's own page shows about the file it is about to save. */
const GUEST_ROWS = `(() => {
  const rows = [...document.querySelectorAll('#tree button.row')].map((row) => ({
    text: (row.textContent ?? '').trim(),
    download: row.parentElement?.querySelector('.download') !== null && row.parentElement !== null,
  }));
  const strip = document.getElementById('file-strip')?.innerText ?? '';
  // The panel's own state, which is what tells a fetch that shut it from one that left it standing:
  // a phone's editor gets the screen between them, and this is the fact a review of the shots cannot
  // read off a picture.
  const panelHidden = document.getElementById('side')?.hidden === true;
  return { rows, strip, panelHidden };
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
  // The path the click opens, read off the row itself rather than off its text: a row carries an
  // icon and the tags the room knows about it as well as the name, and a name is not a path. A file
  // row holds its leaf in its own `.label`, and the directory it sits in is the nearest
  // `details[data-dir]`.
  const openedPath = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#tree button.row')];
    const first = rows.find((row) => /README[.]md|notes[.]md/.test(row.textContent ?? '')) ?? rows[0];
    const leaf = first.querySelector('.label')?.textContent ?? '';
    const dir = first.closest('details[data-dir]')?.dataset.dir ?? '';
    first.click();
    return dir === '' ? leaf : dir + '/' + leaf;
  })()`);
  await waitFor(
    page,
    'the file in the editor',
    `[...document.querySelectorAll('.monaco-editor .view-line')].some((line) => (line.textContent ?? '').trim() !== '')`,
    (there) => there === true,
  );
  return openedPath;
}

/**
 * What the design fixes, in px, as the prototype draws it at this width. Every number here was
 * measured off the prototype in a browser (`ai_notes/.tmp/presence-prototype/index.html`, 1280 wide)
 * and is what a run of this driver checks the page against.
 */
const DESIGN_DESKTOP = {
  bar: 57.8,
  strip: 38.8,
  side: 336,
  leave: 30.1,
  treeActions: 43.4,
};

/** The same, at 390x844: the phone's row, its bar, its strip, and the two text edges. */
const DESIGN_PHONE = {
  row: 44,
  bar: 111.4,
  strip: 44,
  chrome: 155,
  barText: 10.5,
  stripText: 9.45,
};

/** Within half a pixel, which is all a layout can be compared at. */
function near(measured, design, tolerance = 0.5) {
  return typeof measured === 'number' && Math.abs(measured - design) <= tolerance;
}

/**
 * The chrome the design fixes, checked against the prototype's own numbers. A shot shows a person
 * whether it looks right; these say whether it measures right, and a miss is reported rather than
 * left in a photograph nobody measures.
 */
function checkDesktopChrome(chrome, failures) {
  const bar = chrome.barBox?.height;
  const strip = chrome.stripBox?.height;
  const side = chrome.sideBox?.width;
  const leave = chrome.leaveBox;
  const actions = chrome.treeActionsBox?.height;
  const said = [
    ['the session bar', bar, DESIGN_DESKTOP.bar],
    ['the file strip', strip, DESIGN_DESKTOP.strip],
    ['the panel', side, DESIGN_DESKTOP.side],
    ['the way out', leave?.height, DESIGN_DESKTOP.leave],
    ['the panel’s create bar', actions, DESIGN_DESKTOP.treeActions],
  ];
  for (const [what, measured, design] of said) {
    if (!near(measured, design)) {
      failures.push(`${what} measures ${measured} px, and the design draws ${design}`);
    }
  }
  if (leave?.width !== leave?.height) {
    failures.push(`the way out is ${leave?.width}x${leave?.height}, and the design draws a square`);
  }
  if (chrome.fileStripIds?.join(',') !== 'file-strip-path') {
    failures.push(`the strip carries more than the path: ${JSON.stringify(chrome.fileStripIds)}`);
  }
  if (chrome.rowTags !== 0) {
    failures.push(`a tree row still wears a mark: ${chrome.rowTags} of them`);
  }
  if (chrome.healthPainted === true && chrome.health === 'ok') {
    failures.push('a healthy room paints a health control');
  }
  for (const folder of chrome.folders ?? []) {
    if (folder.chevron === true) failures.push(`${folder.name} still draws a chevron`);
    if (!folder.name.endsWith('/')) failures.push(`${folder.name} is not named as a folder`);
    if ((folder.icons ?? []).length !== 2) failures.push(`${folder.name} draws ${folder.icons?.length} folder glyphs`);
  }
}

/** The phone's own numbers, from the same prototype at 390x844. */
function checkPhoneChrome(chrome, failures) {
  const rows = chrome.rowHeights ?? [];
  const bar = chrome.barBox;
  const strip = chrome.stripBox;
  const barText = chrome.barText === null || chrome.barText === undefined ? null : chrome.barText.left - (bar?.left ?? 0);
  const stripText = chrome.stripText === null || chrome.stripText === undefined ? null : chrome.stripText.left - (strip?.left ?? 0);
  if (rows.length === 0) {
    failures.push('the phone’s panel draws no rows to measure');
  }
  for (const height of rows) {
    if (!near(height, DESIGN_PHONE.row, 1)) {
      failures.push(`a phone tree row measures ${height} px, and the design draws ${DESIGN_PHONE.row}`);
    }
  }
  if (!near(bar?.height, DESIGN_PHONE.bar, 1)) failures.push(`the phone bar measures ${bar?.height} px, not ${DESIGN_PHONE.bar}`);
  if (!near(strip?.height, DESIGN_PHONE.strip, 1)) failures.push(`the phone strip measures ${strip?.height} px, not ${DESIGN_PHONE.strip}`);
  if (!near(barText, DESIGN_PHONE.barText, 1)) failures.push(`the phone bar’s text starts ${barText} px in, not ${DESIGN_PHONE.barText}`);
  if (!near(stripText, DESIGN_PHONE.stripText, 1)) failures.push(`the phone strip’s text starts ${stripText} px in, not ${DESIGN_PHONE.stripText}`);
  if (chrome.fileStripIds?.join(',') !== 'file-strip-path') {
    failures.push(`the phone’s strip carries more than the path: ${JSON.stringify(chrome.fileStripIds)}`);
  }
}

/** The desktop shots, in the mouse browser: the layout a real pointer gets, and every new control. */
async function reviewDesktop(page, server, written, failures) {
  const openedPath = await hostAndOpen(page, server);
  const chrome = await page.evaluate(CHROME);
  log('desktop chrome:', JSON.stringify(chrome));
  checkDesktopChrome(chrome, failures);
  log(
    'the design’s numbers: bar',
    chrome.barBox?.height,
    'strip',
    chrome.stripBox?.height,
    'panel',
    chrome.sideBox?.width,
    'way out',
    `${chrome.leaveBox?.width}x${chrome.leaveBox?.height}`,
    'create bar',
    chrome.treeActionsBox?.height,
  );
  log('the panel’s verbs:', JSON.stringify(chrome.treeActions), 'the folders:', JSON.stringify(chrome.folders));
  log('wrote', await record(written, page, '01-in-room-desktop.png'));
  // And the two pieces of chrome this wave changed, cropped so they can be read: the panel with its
  // folder rows and its create bar, and the session bar with the way out and no health dot.
  for (const [name, box] of [
    ['01b-panel.png', chrome.sideBox],
    ['01c-session-bar.png', chrome.barBox],
  ]) {
    if (box === null || box === undefined) {
      failures.push(`${name} has no box to crop to`);
      continue;
    }
    written.push(name);
    log(
      'wrote the crop',
      await page.shot(name, { x: box.left, y: box.top, width: box.width, height: box.height, scale: 1 }),
    );
  }
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

  // The own-name edit, asked for the way a person asks: your own face in the bar, then Rename in
  // the menu it opens.
  await page.evaluate(`document.querySelector('#faces .av.me').click()`);
  await waitFor(
    page,
    'the menu your own face opens',
    `document.getElementById('menu')?.getAttribute('aria-label') ?? null`,
    (label) => label === 'Ada',
  );
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('#menu button')].find((candidate) => /Rename/.test(candidate.textContent ?? ''));
    button.click();
    return button.textContent;
  })()`);
  await waitFor(
    page,
    'the rename field and its two controls',
    `[document.querySelectorAll('#menu .rename').length, document.querySelectorAll('#menu .rename-save').length, document.querySelectorAll('#menu .rename-cancel').length].join(',')`,
    (counts) => counts === '1,1,1',
  );
  await delay(300);
  facts.ownMenu = await page.evaluate(MENU);
  log('your own menu, with the edit open:', JSON.stringify(facts.ownMenu));
  log('wrote', await record(written, page, '04-rename-field-open.png'));
  await page.evaluate(`document.querySelector('#menu .rename-cancel')?.click()`);
  await delay(200);
  // Escape closes the dialog and puts focus back on the face it came from: the menu is a dialog, and
  // a dialog that closed onto nothing is a person who has to find their place again.
  facts.afterEscape = await page.evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const face = document.querySelector('#faces .av.me');
    return { menu: document.getElementById('menu') === null ? 'closed' : 'open', focused: document.activeElement === face };
  })()`);
  log('Escape on the menu:', JSON.stringify(facts.afterEscape));

  // A press that lands outside the dialog takes it down, and it is the same press that moves the
  // caret: the person asked for the editor, and the dialog is not between them and it.
  await page.evaluate(`document.querySelector('#faces .av.me').click()`);
  await waitFor(
    page,
    'your own menu again',
    `document.getElementById('menu') === null ? null : 'open'`,
    (open) => open === 'open',
  );
  const editorPoint = await page.evaluate(`(() => {
    const box = document.querySelector('.monaco-editor')?.getBoundingClientRect();
    return box === undefined ? null : { x: Math.round(box.left + 80), y: Math.round(box.top + 70) };
  })()`);
  if (editorPoint !== null) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: editorPoint.x, y: editorPoint.y, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: editorPoint.x, y: editorPoint.y, button: 'left', clickCount: 1 });
    await delay(200);
    facts.afterOutsidePress = await page.evaluate(`(() => ({
      menu: document.getElementById('menu') === null ? 'closed' : 'open',
      focused: document.activeElement === null ? 'none' : (document.activeElement.tagName + '.' + String(document.activeElement.className).split(' ')[0]),
    }))()`);
    log('a press outside the menu:', JSON.stringify(facts.afterOutsidePress));
    if (facts.afterOutsidePress.menu !== 'closed') {
      failures.push('a press outside the dialog left it open');
    }
  }

  // The room fills: the real engines over the real wire, one caret each in the file the page has
  // open. Five seats beside the host's own is one more than a desktop bar shows, which is what puts
  // the `+N` on the bar — and what the followed face has to be pinned out from behind.
  const invite = await copyInvite(page, server.origin);
  const guests = [];
  try {
    for (const displayName of ['Bob', 'Carla', 'Dee', 'Emil', 'Fay']) {
      const engine = await PeerEngine.join({
        invite,
        displayName,
        webSocketFactory: nativeWebSocketFactory,
      });
      guests.push(engine);
      // Opened, not only selected: a path is what the room reads off the peer, and a menu with no
      // `Go to` in it is a menu with nothing to photograph.
      await engine.open(openedPath);
      engine.setSelection(openedPath, { anchor: 0, head: 3 });
    }
    await waitFor(
      page,
      'four faces and the +N over the rest',
      `document.querySelectorAll('#faces .av').length`,
      (count) => count === 5,
    );
    await delay(300);
    facts.faces = await page.evaluate(FACES);
    facts.hostFace = facts.faces.faces.find((face) => /, host/.test(face.label))?.label ?? '';
    // The same reading the phone takes, on a pointer device's bar: the cluster's own cost there.
    facts.barCost = await page.evaluate(BAR_COST);
    log('the faces in the bar:', JSON.stringify(facts.faces));
    log('what the faces cost the bar:', JSON.stringify(facts.barCost));
    log('wrote', await record(written, page, '16-faces-in-the-bar.png'));

    // Bob's menu, from his own face: where he is, `Go to`, and `Follow`.
    await page.evaluate(`(() => {
      const face = [...document.querySelectorAll('#faces .av')].find((candidate) =>
        (candidate.getAttribute('aria-label') ?? '').startsWith('Bob'),
      );
      face.click();
      return true;
    })()`);
    await waitFor(
      page,
      'Bob’s menu',
      `document.getElementById('menu')?.getAttribute('aria-label') ?? null`,
      (label) => label === 'Bob',
    );
    await delay(300);
    facts.personMenu = await page.evaluate(MENU);
    log('a person’s menu:', JSON.stringify(facts.personMenu));
    log('wrote', await record(written, page, '17-person-menu.png'));

    // Follow, from the menu. The state is the followed face's own ring and its eye — the strip's
    // segment is gone, and the design draws the follow on the face — and the press takes the dialog
    // down, so what follows is the bar showing the follow it turned on.
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('#menu button')].find((candidate) => /^Follow$/.test((candidate.textContent ?? '').trim()));
      button.click();
      return true;
    })()`);
    const followed = await waitFor(
      page,
      'the followed face to wear its ring and its eye',
      `(() => {
        const face = [...document.querySelectorAll('#faces .av')].find((candidate) => (candidate.getAttribute('aria-label') ?? '').startsWith('Bob'));
        return face === undefined ? null : {
          label: face.getAttribute('aria-label'),
          classes: face.className,
          eye: face.querySelector('.eye') !== null,
        };
      })()`,
      (read) => read !== null && read.classes.includes('followed') && read.eye === true,
    );
    facts.followMark = followed;
    facts.menuClosedOnFollow = await page.evaluate(`document.getElementById('menu') === null`);
    facts.following = await page.evaluate(FACES);
    log('following:', JSON.stringify(followed), 'the faces:', JSON.stringify(facts.following));
    await delay(400);
    log('wrote', await record(written, page, '05-following-a-peer.png'));

    // A follow from the menu leaves focus on the followed face: the anchor face the press came
    // from, which the follow pins into the strip. A redraw that replaced the faces without putting
    // it back left focus on the body, and the next Tab started from the top of the page.
    facts.followFocus = await page.evaluate(FOCUS);
    log('focus after following from the menu:', JSON.stringify(facts.followFocus));
    const followedFace = facts.following.faces.find((face) => face.classes.includes('followed'));
    if (facts.followFocus.onAFace !== true || facts.followFocus.label !== followedFace?.label) {
      failures.push(`following from the menu left focus on ${JSON.stringify(facts.followFocus)}, not the followed face ${JSON.stringify(followedFace?.label)}`);
    }

    // And a face keeps focus while somebody else types: a presence frame lands on every keystroke
    // and every face is drawn again. Focus one, move a peer's caret, and read it back.
    facts.carlaFocused = await page.evaluate(`(() => {
      const face = [...document.querySelectorAll('#faces .av')].find((candidate) => (candidate.getAttribute('aria-label') ?? '').startsWith('Carla'));
      face.focus();
      return document.activeElement === face;
    })()`);
    guests[0].setSelection(openedPath, { anchor: 12, head: 13 });
    await delay(700);
    facts.focusWhileATypingPeer = await page.evaluate(FOCUS);
    log('focus while a peer types:', JSON.stringify(facts.focusWhileATypingPeer));
    if ((facts.focusWhileATypingPeer.label ?? '').startsWith('Carla') !== true) {
      failures.push(`a peer's presence frame dropped focus to ${JSON.stringify(facts.focusWhileATypingPeer)}`);
    }

    // Everyone in the room: the `+N` opens the list, and a row opens that person's menu with the way
    // back to the list in it. Fay is the last seat, so she is one of the faces the bar counted away.
    await page.evaluate(`document.querySelector('#faces .av.more').click()`);
    await waitFor(
      page,
      'the list of everyone',
      `document.getElementById('menu')?.getAttribute('aria-label') ?? null`,
      (label) => label === 'Everyone in the room',
    );
    await delay(300);
    facts.everyone = await page.evaluate(MENU);
    log('everyone in the room:', JSON.stringify(facts.everyone));
    log('wrote', await record(written, page, '18-everyone-in-the-room.png'));

    await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('#menu .list button')].find((candidate) =>
        (candidate.getAttribute('aria-label') ?? '').startsWith('Fay'),
      );
      row.click();
      return true;
    })()`);
    await waitFor(
      page,
      'Fay’s menu, opened from the list',
      `document.getElementById('menu')?.querySelector('.back')?.textContent ?? null`,
      (back) => back === 'Everyone in the room',
    );
    await delay(300);
    facts.menuFromTheList = await page.evaluate(MENU);
    log('a person’s menu, opened from the list:', JSON.stringify(facts.menuFromTheList));
    log('wrote', await record(written, page, '19-menu-from-the-list.png'));

    // The way back puts focus on the row the person was picked from, which is the row they are
    // looking for when the list returns.
    facts.backToList = await page.evaluate(`(() => {
      document.querySelector('#menu .back').click();
      const active = document.activeElement;
      const rows = [...document.querySelectorAll('#menu .list button')];
      const picked = rows.find((row) => (row.getAttribute('aria-label') ?? '').startsWith('Fay'));
      return {
        label: document.getElementById('menu')?.getAttribute('aria-label') ?? null,
        rows: rows.map((row) => (row.getAttribute('aria-label') ?? '').split(',')[0]),
        focusIsThePickedRow: active === picked,
      };
    })()`);
    log('back to the list:', JSON.stringify(facts.backToList));

    // Follow the seat the bar counted away: the ring is the one place a follow shows on the bar, so
    // the face wearing it takes the last shown slot instead of staying behind the count.
    await page.evaluate(`(() => {
      const row = [...document.querySelectorAll('#menu .list button')].find((candidate) =>
        (candidate.getAttribute('aria-label') ?? '').startsWith('Fay'),
      );
      row.click();
      return true;
    })()`);
    await waitFor(
      page,
      'Fay’s menu again',
      `document.getElementById('menu')?.getAttribute('aria-label') ?? null`,
      (label) => label === 'Fay',
    );
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('#menu button')].find((candidate) => /^Follow$/.test((candidate.textContent ?? '').trim()));
      button.click();
      return true;
    })()`);
    await waitFor(
      page,
      'the followed face to be pinned onto the bar',
      `document.querySelector('#faces .av[aria-label^="Fay"]') === null ? null : 'shown'`,
      (shown) => shown === 'shown',
    );
    facts.pinnedFollowing = await page.evaluate(FACES);
    log('following a face that was behind the count:', JSON.stringify(facts.pinnedFollowing));
    // The last *face*, not the last button: the `+N` stands after every face it counts.
    const shownNow = facts.pinnedFollowing.faces.filter((face) => !face.classes.includes('more'));
    if (!/^Fay, following$/.test(shownNow.at(-1)?.label ?? '')) {
      failures.push(
        `the followed face is not the last one shown: ${JSON.stringify(facts.pinnedFollowing.faces.map((face) => face.label))}`,
      );
    }
    await delay(400);
    log('wrote', await record(written, page, '20-following-a-pinned-face.png'));

    // One peer into the folder the run seeded, for the one thing a shot of the panel has to show: a
    // shut folder wearing the badges of the peers inside it, which is what the design draws where
    // this page used to draw nothing.
    await guests[0].open('src/main.ts');
    // The presence path is what the row is drawn from, and it is published with the caret: an open
    // alone takes the hold and says nothing about where the peer is.
    guests[0].setSelection('src/main.ts', { anchor: 0, head: 3 });
    await waitFor(
      page,
      'the folder’s own badges',
      `document.querySelectorAll('#tree details[data-dir="src"] summary .badge').length`,
      (count) => count > 0,
    );
    await delay(400);
    const panelBox = await page.evaluate(`(() => {
      const box = document.getElementById('side').getBoundingClientRect();
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    })()`);
    facts.panelFolders = await page.evaluate(`[...document.querySelectorAll('#tree details[data-dir] > summary')].map((summary) => ({
      name: summary.querySelector('.label')?.textContent ?? '',
      open: summary.parentElement?.open === true,
      badges: [...summary.querySelectorAll('.badge')].map((badge) => badge.title),
    }))`);
    log('the folder with a peer in it:', JSON.stringify(facts.panelFolders));
    written.push('16b-panel-with-a-room.png');
    log('wrote the panel with a room in it:', await page.shot('16b-panel-with-a-room.png', { ...panelBox, scale: 1 }));
  } finally {
    for (const engine of guests) {
      await engine.disconnect();
    }
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

  // What a host's own edit does to the folder it was handed. The page keeps the file in the
  // editor and the folder on disk, and nothing on the page saves, so a change this window makes
  // has to be written back by the page itself — a peer's edit already is, and this is the other
  // half. Typed through the real input path and read back out of the origin-private directory
  // the picker stands in for, so the proof is the file's own bytes and not the editor's state.
  // The file the check reads is the path `hostAndOpen` actually opened, and what it is compared with
  // is what the editor is showing rather than a substring of it: the claim is that the file on disk
  // *is* the buffer, and `includes` passes on a file that has grown a second copy of the text. A miss
  // fails the run (see `failures`), because a fact recorded as `false` with exit 0 is a proof nobody
  // is told about.
  const marker = 'HOST-EDIT-REACHES-THE-FOLDER';
  const readFolder = `(async () => {
    const root = await navigator.storage.getDirectory();
    let dir = await root.getDirectoryHandle('project');
    const parts = ${JSON.stringify(openedPath.split('/'))};
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part);
    }
    const handle = await dir.getFileHandle(parts[parts.length - 1]);
    return await (await handle.getFile()).text();
  })()`;
  // Monaco renders the lines it is showing and keeps the whole buffer; for a document this small
  // (the seeded README is three lines) every line is rendered, so the joined lines are the buffer's
  // text. The model's own text is what the claim is about, and this is the only way to it from
  // outside the page: the bundle keeps `monaco` to itself. What the DOM holds is not quite the
  // buffer — Monaco paints a space as `&nbsp;` so a run of them keeps its width — so the rendered
  // form is read back as the text it stands for.
  const readEditor = `[...document.querySelectorAll('.monaco-editor .view-line')]
    .map((line) => (line.textContent ?? '').replace(/\\u00a0/g, ' '))
    .join('\\n')`;
  // The page's own transient line, which is where a refused write lands: the row wears no mark for
  // it any more, and the sentence stands until its own clock takes it down.
  const readWarned = `document.getElementById('alert')?.textContent ?? ''`;
  const editorBox = await page.evaluate(`(() => {
    const box = document.querySelector('.monaco-editor')?.getBoundingClientRect();
    return box === undefined || box === null
      ? null
      : { x: Math.round(box.left + 60), y: Math.round(box.top + 60) };
  })()`);
  const before = await page.evaluate(readFolder);
  const alreadyThere = before.includes(marker);
  // The precondition the check rests on: nothing else has written this file yet. The only other
  // writer is the bridge's own save, which fires on an edit the *room* made; the peers this run
  // joined hold a selection each and type nothing. A file that no longer holds what the picker
  // seeded it with is therefore caught here, before the check can mistake it for this window's own
  // write.
  if (before !== SEED[openedPath]) {
    failures.push(
      `${openedPath} was already ${JSON.stringify(before)} before the host typed, so this check cannot tell the host\u2019s own write from another`,
    );
  }
  if (editorBox === null) {
    facts.hostWriteBack = { typed: false, why: 'no editor on screen', path: openedPath };
    failures.push(`the host\u2019s own edit: no editor on screen for ${openedPath}, so nothing was typed`);
  } else {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: editorBox.x,
      y: editorBox.y,
      button: 'left',
      clickCount: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: editorBox.x,
      y: editorBox.y,
      button: 'left',
      clickCount: 1,
    });
    await page.send('Input.insertText', { text: marker });
    try {
      await waitFor(
        page,
        'the host\u2019s own edit to reach the folder',
        readFolder,
        (text) => typeof text === 'string' && text.includes(marker),
        5_000,
      );
      // The write landed. What it landed is the whole of the claim: the file on disk is the text the
      // editor holds, and the page said nothing about a refusal.
      const onDisk = await page.evaluate(readFolder);
      const inEditor = await page.evaluate(readEditor);
      const warned = await page.evaluate(readWarned);
      const equalsEditor = onDisk === inEditor;
      facts.hostWriteBack = {
        typed: true,
        path: openedPath,
        reachedTheFolder: true,
        equalsEditor,
        said: warned,
        alreadyThere,
      };
      if (!equalsEditor) {
        failures.push(
          `the host\u2019s own edit: ${openedPath} on disk is not what the editor holds (file ${JSON.stringify(onDisk)}, editor ${JSON.stringify(inEditor)})`,
        );
      }
      if (warned.includes(openedPath)) {
        failures.push(
          `the host\u2019s own edit: the page says ${JSON.stringify(warned)} about ${openedPath}, and the write landed`,
        );
      }
    } catch (error) {
      facts.hostWriteBack = {
        typed: true,
        path: openedPath,
        reachedTheFolder: false,
        alreadyThere,
        why: String(error),
      };
      failures.push(`the host\u2019s own edit never reached ${openedPath}`);
    }
  }
  log('the host\u2019s own edit and the folder:', JSON.stringify(facts.hostWriteBack));
  return { facts, invite, openedPath };
}

/** The touch shots, in the touch browser: the phone's layout, and a guest fetching a file to save. */
async function reviewTouch(page, server, invite, written, openedPath, failures) {
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

  // The phone as a host, before it joins anywhere as a guest: the session's own name is the host's
  // `Sharing “project”`, and it is the bar's identity — whole, or cut by the faces and the way out
  // beside it — that the way out's width decides. This is the state the design measures whole.
  await page.setViewport(PHONE, { touch: true });
  await hostAndOpen(page, server);
  await delay(400);
  facts.hostPhoneBar = await page.evaluate(BAR_COST);
  facts.hostPhoneLeave = await page.evaluate(LEAVE);
  facts.hostPhoneTap = await page.evaluate(TAP_WIDTH);
  log('the host phone’s bar:', JSON.stringify(facts.hostPhoneBar));
  log('the phone’s way out, as host:', JSON.stringify(facts.hostPhoneLeave));
  if (facts.hostPhoneBar.identityTruncatedWithFaces === true) {
    failures.push(`the host’s session name is cut at ${JSON.stringify(facts.hostPhoneBar.identityWithFaces)}`);
  }
  if (facts.hostPhoneBar.barWithFaces !== 111) {
    failures.push(`the host’s phone session bar is ${facts.hostPhoneBar.barWithFaces} px, not 111`);
  }
  if (facts.hostPhoneLeave !== null && facts.hostPhoneLeave.width !== 44) {
    failures.push(`the host’s way out is ${facts.hostPhoneLeave.width} px wide, not the design’s 44`);
  }
  log('wrote', await record(written, page, '24-phone-host-bar.png'));
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

  // The phone's own chrome, with the panel open: the tree rows the design draws at 44 px, the bar
  // and the strip at their own heights, and the two text edges. The panel is shut again after it,
  // because the rest of this pass photographs a guest at rest.
  await page.evaluate(`(() => {
    if (document.getElementById('side').hidden) document.getElementById('file-strip').click();
    return true;
  })()`);
  await waitFor(
    page,
    'the phone’s panel to open on the tree',
    `document.querySelectorAll('#tree li').length`,
    (rows) => rows > 0,
  );
  await delay(400);
  facts.phoneChrome = await page.evaluate(CHROME);
  checkPhoneChrome(facts.phoneChrome, failures);
  log(
    'the phone’s chrome: bar',
    facts.phoneChrome.barBox?.height,
    'strip',
    facts.phoneChrome.stripBox?.height,
    'rows',
    JSON.stringify(facts.phoneChrome.rowHeights),
    'bar text',
    facts.phoneChrome.barText?.left,
    'strip text',
    facts.phoneChrome.stripText?.left,
    'verbs',
    JSON.stringify(facts.phoneChrome.treeActions),
  );
  log('wrote', await record(written, page, '25-phone-panel-chrome.png'));
  await page.evaluate(`document.getElementById('file-strip').click()`);
  await delay(300);

  // The bar's faces on a phone: your own seat, the host's crowned one, and the rest counted, with
  // the cluster costing the bar nothing — measured against the same bar with the cluster hidden,
  // which is the only reading that says "0 px" rather than "small".
  const crowd = [];
  try {
    for (const displayName of ['Gus', 'Hal', 'Ivy']) {
      const engine = await PeerEngine.join({
        invite,
        displayName,
        webSocketFactory: nativeWebSocketFactory,
      });
      crowd.push(engine);
      await engine.open(openedPath);
      engine.setSelection(openedPath, { anchor: 0, head: 3 });
    }
    await waitFor(
      page,
      'two faces and the +N over the rest, on a phone',
      `document.querySelectorAll('#faces .av').length`,
      (count) => count === 3,
    );
    await delay(400);
    facts.phoneFaces = await page.evaluate(FACES);
    facts.phoneBar = await page.evaluate(BAR_COST);
    facts.phoneTap = await page.evaluate(TAP_WIDTH);
    facts.phoneLeave = await page.evaluate(LEAVE);
    log('the phone’s faces:', JSON.stringify(facts.phoneFaces));
    log('what the faces cost the bar:', JSON.stringify(facts.phoneBar));
    if (facts.phoneBar.added !== 0) {
      failures.push(`the faces add ${facts.phoneBar.added} px to the phone’s session bar`);
    }
    log('the phone’s way out, as guest:', JSON.stringify(facts.phoneLeave));
    log('the neighbour face’s tap area:', JSON.stringify(facts.phoneTap));
    // The session's own name is whole with the faces beside it: the way out's 44 px is what gives
    // the name the room the text verb took.
    if (facts.phoneBar.identityTruncatedWithFaces === true) {
      failures.push(`the guest’s session name is cut at ${JSON.stringify(facts.phoneBar.identityWithFaces)}`);
    }
    if (facts.phoneTap !== null && facts.phoneTap.columns - (facts.phoneTap.peer ?? 0) > 14) {
      failures.push(`the face beside your own answers for ${facts.phoneTap.peer ?? 0} of its ${facts.phoneTap.columns} columns`);
    }
    log('wrote', await record(written, page, '21-phone-faces-in-the-bar.png'));

    // A face's menu on a phone, and the follow that pins a counted-away face onto the bar.
    facts.phoneMenu = await page.evaluate(`(() => {
      document.querySelector('#faces .av:not(.me)').click();
      return true;
    })()`);
    await waitFor(
      page,
      'a face’s menu on a phone',
      `document.getElementById('menu') === null ? null : 'open'`,
      (open) => open === 'open',
    );
    await delay(300);
    facts.phonePersonMenu = await page.evaluate(MENU);
    log('a person’s menu on a phone:', JSON.stringify(facts.phonePersonMenu));
    log('wrote', await record(written, page, '22-phone-person-menu.png'));
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await delay(200);

    // Behind the count: the `+N` on a phone, the last face on the list, and the ring that brings it
    // back onto the bar.
    const last = facts.phoneFaces.faces.at(-1);
    await page.evaluate(`document.querySelector('#faces .av.more').click()`);
    await waitFor(
      page,
      'the list of everyone on a phone',
      `document.getElementById('menu')?.getAttribute('aria-label') ?? null`,
      (label) => label === 'Everyone in the room',
    );
    await page.evaluate(`(() => {
      const row = document.querySelector('#menu .list li:last-child button');
      row.click();
      return true;
    })()`);
    await waitFor(
      page,
      'the last seat’s menu on a phone',
      `document.getElementById('menu')?.querySelector('.back')?.textContent ?? null`,
      (back) => back === 'Everyone in the room',
    );
    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('#menu .acts button')].find((candidate) => /^Follow$/.test((candidate.textContent ?? '').trim()));
      button.click();
      return true;
    })()`);
    await delay(400);
    facts.phoneFollowing = await page.evaluate(FACES);
    log('the phone following the last seat on the list:', JSON.stringify(facts.phoneFollowing), 'was:', JSON.stringify(last));
    log('wrote', await record(written, page, '23-phone-follows-a-pinned-face.png'));
  } finally {
    for (const engine of crowd) {
      await engine.disconnect();
    }
  }
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
  //
  // Which row that is is not on the tree: a file whose text is already in this window and one the
  // room does not hold look exactly alike now that the row draws no dot for "the text is here", and
  // a row whose text *is* here saves the file at once and says nothing about a fetch. So the row is
  // found by asking each one in turn and keeping the first that answers with the cost line.
  const candidates = await page.evaluate(`[...document.querySelectorAll('#tree li.file')]
    .map((item) => item.querySelector('.download'))
    .filter((button) => button !== null)
    .map((button) => (button.getAttribute('aria-label') ?? '').replace(/^Download /, ''))`);
  facts.downloadCandidates = candidates;
  let target = null;
  for (const path of candidates) {
    await page.evaluate(`(() => {
      const label = 'Download ' + ${JSON.stringify(path)};
      const button = [...document.querySelectorAll('#tree .download')].find(
        (candidate) => candidate.getAttribute('aria-label') === label,
      );
      button?.click();
      return true;
    })()`);
    try {
      await waitFor(
        page,
        'the row to say what the fetch costs',
        ROW_NOTE,
        (note) => note !== null && /Fetching opens/.test(note.text),
        1500,
      );
      target = path;
      break;
    } catch {
      // This window held the text, so the page saved the file at once: not the row to photograph.
    }
  }
  facts.downloadTarget = target;
  log('a file with no text here, saved from its row:', JSON.stringify(target), 'of', JSON.stringify(candidates));
  if (target === null) {
    throw new Error('no row offered a fetch: nothing to photograph');
  }
  facts.fetchNote = await page.evaluate(ROW_NOTE);
  facts.fetchBusy = await page.evaluate(
    `document.querySelector('#tree .row-actions.busy')?.getAttribute('aria-label') ?? null`,
  );
  log('the fetch, in the row it is about:', JSON.stringify(facts.fetchNote), facts.fetchBusy);
  log('wrote', await record(written, page, '11-download-unfetched-phone.png'));

  // Where it ended. A fetch says what it costs, asks the room, and only the text arriving ends with
  // the row idle and nothing to say: the row's busy mark is what the page clears when the fetch
  // settles on a save, and a room that answered with an empty document or has said nothing at all
  // leaves its own line up. What that line *offers* tells those two apart — the first offers to save
  // an empty file and the second says the wait is still running — and a run that recorded only the
  // words could not say which of the two it saw.
  //
  // What is *not* read here is the `●` the row used to gain when the text landed, or the `not
  // fetched yet` tag that replaced it. The row states nothing about the room now: the busy mark is
  // the page's own statement that the fetch has not settled, and the line under the row says what
  // became of it.
  // The path the driver clicked, and no other: a fetch of `notes.md` is not a fetch of `main.ts`.
  let sawBusy = false;
  const landed = async () => {
    const row = await page.evaluate(
      `(() => {
        const wanted = ${JSON.stringify(target)};
        const leaf = wanted.slice(wanted.lastIndexOf('/') + 1);
        const found = [...document.querySelectorAll('#tree button.row')].find((candidate) =>
          [...candidate.querySelectorAll('span.label')].some((span) => span.textContent === leaf),
        );
        if (found === undefined) return null;
        return { busy: found.querySelector('.row-actions.busy') !== null };
      })()`,
    );
    if (row === null) return false;
    sawBusy = sawBusy || row.busy;
    // Settled means the row is not working: the busy mark is the page's only statement about a
    // fetch in flight now that no row says what the room holds, and a fast answer can be over before
    // the first read — which is why the mark is recorded rather than required.
    return !row.busy;
  };
  let outcome = { landed: false, note: null, state: 'none' };
  const states = [];
  for (let tick = 0; tick < 160 && !outcome.landed; tick += 1) {
    const note = await page.evaluate(ROW_NOTE);
    const state = settledState(note);
    outcome = { landed: state === 'none' && (await landed()), note, state };
    if (states[states.length - 1] !== state) states.push(state);
    if (state === 'empty' || state === 'pending') break;
    await delay(250);
  }
  facts.fetchStates = states;
  facts.fetchOutcome = { ...outcome, sawBusy };
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
    facts.fetchOutcome = { ...outcome, sawBusy };
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
    );
  }
  // The panel is where the row's own line lives, so a shot of a row has to be a shot of the panel.
  // Nothing opens a file here any more: the room's document set moving used to open the first
  // document it named, which on a phone collapsed the panel over the very row the person acted on.
  await page.evaluate(`(() => {
    if (document.getElementById('side').hidden) document.getElementById('file-strip').click();
    for (const details of document.querySelectorAll('#tree details')) {
      if (details.open === false) details.querySelector('summary').click();
    }
    return true;
  })()`);
  await delay(500);
  log('wrote', await record(written, page, '12-download-not-answered-phone.png'));
  if (FOOTER) {
    // The demo's notice once a session is on screen: the same page, viewport and notice as the
    // pre-join shot, with the rule the phone query applies to it while a session is up. The two
    // measurements are what say whether it shrank, and by how much (design §5 of the session pass).
    facts.footerInRoom = await page.evaluate(`(() => {
      const aside = document.getElementById('demo-footer');
      if (aside === null) return null;
      const box = aside.getBoundingClientRect();
      const style = getComputedStyle(aside);
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        height: Math.round(box.height * 100) / 100,
        fontSize: style.fontSize,
        padding: style.paddingTop,
        termsVisible: document.getElementById('terms-link')?.getClientRects().length > 0,
        text: aside.innerText,
      };
    })()`);
    log('the demo footer in a room:', JSON.stringify(facts.footerInRoom));
    log('wrote', await record(written, page, '15-phone-footer-in-room.png'));
  }

  return facts;
}

/**
 * The empty room: a host whose folder holds nothing, and the guest that joins it.
 *
 * This is the one shape where the editor pane has no document to show — the seeded folder always
 * gives the room a file to open, and a page with a document in front of it never shows the pane's
 * empty state — so it is the only place those states can be photographed (design §7.2, §7.4). It
 * runs last, in the two browsers already up: the host leaves the room it was in and starts another
 * from an empty folder, and the guest leaves its room and joins that one. Both leave by the control
 * a person uses, and the guest comes back in by pasting the link, which is the card's own way.
 */
async function reviewEmptyRoom(hostPage, guestPage, server, written) {
  const facts = {};
  await hostPage.setViewport(DESKTOP);
  // A host's press asks first: its leaving ends the room for everyone in it.
  await hostPage.evaluate(`document.getElementById('leave').click()`);
  await waitFor(
    hostPage,
    'the host’s leave question',
    `document.getElementById('leave-confirm')?.hidden === false`,
    (up) => up === true,
  );
  await hostPage.evaluate(`document.getElementById('leave-anyway').click()`);
  await waitFor(
    hostPage,
    'the card back after leaving',
    `document.getElementById('join')?.hidden === false`,
    (up) => up === true,
  );
  // The card came back as the guest's intent, so hosting is the quiet line again: press it, and
  // the start card — the button and the paragraph — is what the press answers with.
  facts.hostCard = await hostPage.evaluate(PREJOIN);
  await hostPage.evaluate(`document.getElementById('host-quiet').click()`);
  await waitFor(
    hostPage,
    'the start card’s own action',
    `document.getElementById('host-button')?.hidden === false`,
    (up) => up === true,
  );
  facts.startCard = await hostPage.evaluate(PREJOIN);
  await hostPage.evaluate(`(() => {
    window.__selvageEmptyFolder = true;
    const name = document.getElementById('name');
    name.value = 'Ada';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('host-button').click();
    return true;
  })()`);
  await waitFor(
    hostPage,
    'the empty room to be seated',
    `(() => { const bar = document.getElementById('session'); return bar === null ? null : !bar.hidden; })()`,
    (seated) => seated === true,
  );
  await waitFor(
    hostPage,
    'the pane to say the folder is empty',
    EMPTY_PANE,
    (state) => state !== null && /is empty/.test(state.blocks[0]?.lead ?? ''),
  );
  await delay(400);
  facts.host = await hostPage.evaluate(EMPTY_PANE);
  log('the host’s empty folder:', JSON.stringify(facts.host));
  log('wrote', await record(written, hostPage, '13-editor-empty-host.png'));

  // The guest: out of the room it was in, and into this one by pasting the link, which is the
  // card's own way back in. A guest's press leaves at once — the room is the host's tab.
  const invite = await copyInvite(hostPage, server.origin);
  await guestPage.evaluate(`document.getElementById('leave').click()`);
  await waitFor(
    guestPage,
    'the guest’s card back',
    `document.getElementById('join')?.hidden === false`,
    (up) => up === true,
  );
  await guestPage.evaluate(`(() => {
    const field = document.getElementById('invite');
    field.value = ${JSON.stringify(invite)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const name = document.getElementById('name');
    name.value = 'Guest';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('join-button').click();
    return true;
  })()`);
  await waitFor(
    guestPage,
    'the guest seated in the empty room',
    `(() => { const bar = document.getElementById('session'); return bar === null ? null : !bar.hidden; })()`,
    (seated) => seated === true,
  );
  await waitFor(
    guestPage,
    'the pane to name the host',
    EMPTY_PANE,
    (state) => state !== null && /shared any files yet/.test(state.blocks[0]?.lead ?? ''),
  );
  await delay(400);
  facts.guest = await guestPage.evaluate(EMPTY_PANE);
  log('the guest in a room that shares nothing:', JSON.stringify(facts.guest));
  log('wrote', await record(written, guestPage, '14-editor-empty-guest.png'));
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
  // What the run found that a photograph cannot be trusted to show. A miss here fails the run at the
  // end, once `facts.json` is written and the browsers are stopped: a check that records `false` and
  // exits 0 is a proof nobody is told about.
  const failures = [];
  const facts = { footer: FOOTER, shots: written, console: [] };
  log('serving', server.origin, FOOTER ? 'with the demo footer' : 'without a footer');
  const browsers = [];
  try {
    const mouse = await launchChromium({ pointer: 'mouse' });
    browsers.push({ name: 'desktop', page: mouse });
    await mouse.setViewport(DESKTOP);
    const desktop = await reviewDesktop(mouse, server, written, failures);
    facts.desktop = desktop.facts;
    const touch = await launchChromium({ pointer: 'touch' });
    browsers.push({ name: 'phone', page: touch });
    facts.phone = await reviewTouch(touch, server, desktop.invite, written, desktop.openedPath, failures);
    // Last, and in the two browsers already up: the empty room's two empty states need a folder with
    // nothing in it, which the seeded run never has (`reviewEmptyRoom`).
    facts.empty = await reviewEmptyRoom(mouse, touch, server, written);
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
      'the demo footer on the card:',
      JSON.stringify(facts.phone.prejoin?.footer),
      'terms link in the viewport:',
      facts.phone.prejoin?.termsLinkInViewport,
      '| in a room:',
      JSON.stringify(facts.phone.footerInRoom ?? null),
    );
  }
  log('the guest card’s other intent:', JSON.stringify(facts.phone.prejoin?.quietLineVisible), JSON.stringify(facts.phone.prejoin?.quietLine));
  if (failures.length > 0) {
    for (const failure of failures) {
      log('FAILED:', failure);
    }
    process.exitCode = 1;
    return;
  }
  log('every check passed');
}

await main();
