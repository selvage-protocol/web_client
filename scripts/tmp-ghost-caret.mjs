// Ghost-document and ghost-caret drive: a real room, two real pages, a built bundle.
//
// Two owner-reported defects, reproduced in the DOM and on the wire:
//   ghost — a room with nothing in front of the editor: typing must not land;
//   caret — a peer's caret must stay a point while the local person types at it.
//
// Usage: node scripts/tmp-ghost-caret.mjs [ghost|caret|all]
// Env:   GHOST_PORT   (default 8095)     the port selvaged and the page are served on
//        SELVAGED     (default the `reference_server` checkout beside this one)
//        GHOST_TAG    (default after-fix) the shot directory under .tmp/ghost-caret/

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { launch } from './tmp-cdp.mjs';
import { SelvageEngine as Engine } from '../src/engine/index.ts';
import { SessionBridge, applyChange } from '../src/bridge/index.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const SHOTS = `${ROOT}/.tmp/ghost-caret`;
/** Which set of shots this run writes: `before-fix` and `after-fix` are kept apart. */
const TAG = process.env.GHOST_TAG ?? 'after-fix';
const PORT = Number(process.env.GHOST_PORT ?? 8095);
const BASE = `ws://127.0.0.1:${PORT}`;
const PAGE = `http://127.0.0.1:${PORT}/`;
/**
 * The sibling checkout's debug server. The five repositories sit side by side, and this
 * driver runs from a nested worktree as often as from the checkout itself, so the
 * sibling is found through the shared git directory rather than by climbing a fixed
 * number of levels. `SELVAGED` names it outright where it lives elsewhere.
 */
function siblingSelvaged() {
  const commonDir = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
  return path.resolve(commonDir, '../../reference_server/target/debug/selvaged');
}
const SELVAGED = process.env.SELVAGED ?? siblingSelvaged();

mkdirSync(`${SHOTS}/${TAG}`, { recursive: true });
mkdirSync(`${SHOTS}/profiles-${TAG}`, { recursive: true });
// Chromium's process singleton lives beside the profile directory, and a unix socket
// path is capped at 107 bytes: under this worktree's profile path it falls back to the
// temp directory, which is just as long. The profiles stay in the checkout (on disk);
// only these transient socket directories go to a short-name directory outside it.
const CHROME_TMP = process.env.GHOST_CHROME_TMP ?? '/tmp/gt';
mkdirSync(CHROME_TMP, { recursive: true });
process.env.TMPDIR = CHROME_TMP;

const lines = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  lines.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`);
  console.log(`${ok ? 'ok: ' : 'FAILED: '}${name}${detail === '' ? '' : ` — ${detail}`}`);
  if (!ok) failed += 1;
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded polling of a real predicate: a sleep is not a wait. */
async function waitFor(label, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = await predicate();
    if (seen !== undefined && seen !== false && seen !== null) return seen;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

async function serve() {
  if (!existsSync(SELVAGED)) {
    throw new Error(
      `no selvaged at ${SELVAGED}: build the sibling reference_server (cargo build) or point SELVAGED at one`,
    );
  }
  const child = spawn(
    SELVAGED,
    ['--listen', `127.0.0.1:${PORT}`, '--serve-page', `${ROOT}/dist`, '--room-grace-ms', '120000'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
  );
  child.stderr.on('data', (data) => process.stderr.write(`[selvaged] ${data}`));
  await waitFor(
    'the page to be served',
    async () => {
      try {
        const response = await fetch(PAGE);
        return response.ok ? true : undefined;
      } catch {
        return undefined;
      }
    },
    20_000,
  );
  return child;
}

/** The page URL for a room's invite, as a guest's link. */
function pageUrlFor(invite) {
  const url = new URL(invite);
  const query = new URLSearchParams({
    room: url.searchParams.get('room') ?? '',
    token: url.searchParams.get('token') ?? '',
    server: BASE,
  });
  return `${PAGE}?${query.toString()}`;
}

const DOM = {
  /** The page's readable state, for the driver's checks and its own log. */
  state: `({
    tree: document.querySelector('#tree').textContent,
    viewText: document.querySelector('#editor .view-lines').innerText,
    roster: [...document.querySelectorAll('#roster li')].map((li) => li.textContent),
    badges: [...document.querySelectorAll('.glyph-margin-widgets > div')].map((d) => ({
      line: Math.round(d.getBoundingClientRect().top),
      cls: d.className,
    })),
    caretBars: [...document.querySelectorAll('#editor .cdr[class*="selvage-"]')].map((bar) => ({
      line: Math.round(bar.getBoundingClientRect().top),
      cls: bar.className,
    })),
    caretTop: (() => {
      const caret = document.querySelector('.cursors-layer .cursor');
      return caret === null ? null : Math.round(caret.getBoundingClientRect().top);
    })(),
  })`,
  /** The first line's top and the line height, so a line number is a pixel target. */
  lineBox: `(() => {
    const line = document.querySelector('#editor .view-line');
    const rect = line.getBoundingClientRect();
    return { top: rect.top, height: rect.height, left: rect.left };
  })()`,
  focusEditor: `(() => {
    const area = document.querySelector('.monaco-editor textarea.inputarea');
    if (area) area.focus();
    return document.activeElement === area;
  })()`,
  /** Monaco paints a space as a non-breaking one, so a text check reads it as a space. */
  read: (text) => text.replace(/\u00a0/g, ' '),
};

async function joinPage(cdp, url, name) {
  await cdp.navigate(url);
  await cdp.evaluate(
    `document.querySelector('#name').value = ${JSON.stringify(name)}; document.querySelector('#join-button').click()`,
  );
  await waitFor(
    `${name} to join`,
    async () =>
      (await cdp.evaluate(`document.querySelector('#workspace').hidden === false`)) || undefined,
    30_000,
  );
  await sleep(1200);
}

/**
 * Puts a page's caret on a line the way a person does: a click in the middle of it.
 * Key batches are not a means to this end — a `rawKeyDown` with no text never reaches
 * Monaco's key handler here, so a driver that trusted one reproduced the wrong line.
 */
async function clickLine(cdp, lineNumber) {
  const box = await cdp.evaluate(DOM.lineBox);
  const y = Math.round(box.top + (lineNumber - 0.5) * box.height);
  const x = Math.round(box.left + 2);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.psend('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    });
  }
  const expected = Math.round(box.top + (lineNumber - 1) * box.height);
  await waitFor(
    `the caret to land on line ${lineNumber}`,
    async () => {
      const state = await cdp.evaluate(DOM.state);
      return state.caretTop === expected ? state.caretTop : undefined;
    },
    10_000,
  );
  return expected;
}

/** A host room with a memory host on this side, the way the proofs mint one. */
class MemHost {
  texts = new Map();
  text(path) {
    return this.texts.get(path);
  }
  lineEnding() {
    return '\n';
  }
  async applyChange(path, change) {
    const current = this.texts.get(path);
    if (current === undefined) return false;
    this.texts.set(path, applyChange(current, change));
    return true;
  }
  async save() {
    return true;
  }
  async readGrantedFile() {
    return undefined;
  }
  renderCursors() {}
  report() {}
}

const SEED = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';

async function ghostRooms() {
  // (a) The room shares nothing at all: no granted path, no open document.
  const emptyHost = await Engine.host(BASE, 'empty-host', { client: 'tmp-ghost-caret/host' });
  // (b) The room lists a file but has nothing open.
  const listedHost = await Engine.host(BASE, 'listed-host', { client: 'tmp-ghost-caret/host' });
  const listedInvite = listedHost.inviteUrl();
  await listedHost.grant(['todo.txt']);

  let cdp;
  try {
    cdp = await launch({
      port: 9351,
      profile: `${SHOTS}/profiles-${TAG}/ghost`,
      width: 1280,
      height: 900,
    });
    cdp.on('Runtime.exceptionThrown', (params) =>
      console.log(`EXC ${JSON.stringify(params.exceptionDetails).slice(0, 300)}`),
    );

    for (const [label, host, invite] of [
      ['no-listing', emptyHost, emptyHost.inviteUrl()],
      ['listing-no-open-document', listedHost, listedInvite],
    ]) {
      if (invite === undefined) throw new Error(`${label}: the host minted no invite`);
      await joinPage(cdp, pageUrlFor(invite), `guest-${label}`);
      const state = await cdp.evaluate(DOM.state);
      console.log(
        `[ghost ${label}] state ${JSON.stringify({
          tree: state.tree,
          viewText: state.viewText,
          documents: host.session().documents,
        })}`,
      );
      check(
        `ghost/${label}: the tree says where the room stands`,
        label === 'no-listing'
          ? state.tree.includes('The room shares no listing yet.')
          : state.tree.includes('todo.txt'),
        state.tree,
      );
      await cdp.shot(`${SHOTS}/${TAG}/ghost-${label}-before-typing.png`);
      // The person types into what looks like a file: it must not land.
      await cdp.evaluate(DOM.focusEditor);
      await cdp.typeText('ghost text nobody sees');
      await cdp.pressKey('Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await sleep(600);
      const after = await cdp.evaluate(DOM.state);
      await cdp.shot(`${SHOTS}/${TAG}/ghost-${label}-after-typing.png`);
      check(
        `ghost/${label}: the buffer still holds no text`,
        after.viewText === state.viewText,
        `before=${JSON.stringify(state.viewText)} after=${JSON.stringify(after.viewText)}`,
      );
      check(
        `ghost/${label}: nothing reached the room`,
        host.session().documents.length === 0,
        JSON.stringify(host.session().documents),
      );
      // A listed file is the way out: opening it puts a document in front of the editor
      // and the editor takes text again the moment it opens.
      if (label === 'listing-no-open-document') {
        await cdp.evaluate(
          `[...document.querySelectorAll('#tree button.row')].find((row) => row.textContent.includes('todo.txt')).click()`,
        );
        await cdp.evaluate(DOM.focusEditor);
        const opened = await waitFor(
          'the opened file to take text',
          async () => {
            await cdp.typeText('x');
            const state = await cdp.evaluate(DOM.state);
            return state.viewText.includes('x') ? state : undefined;
          },
          15_000,
        );
        await cdp.shot(`${SHOTS}/${TAG}/ghost-listing-opened-takes-text.png`);
        check(
          'ghost/listing-no-open-document: opening a listed file makes the editor editable again',
          opened.viewText.includes('x'),
          JSON.stringify(opened.viewText),
        );
        check(
          'ghost/listing-no-open-document: the open reaches the tree',
          (
            await cdp.evaluate(`document.querySelector('#tree button.row.open')?.textContent ?? ''`)
          ).includes('todo.txt'),
          await cdp.evaluate(`document.querySelector('#tree button.row.open')?.textContent ?? 'no open row'`),
        );
      }
    }
  } finally {
    await cdp?.close();
    await emptyHost.disconnect();
    await listedHost.disconnect();
  }
}

async function caretRoom() {
  const host = await Engine.host(BASE, 'caret-host', { client: 'tmp-ghost-caret/host' });
  const invite = host.inviteUrl();
  if (invite === undefined) throw new Error('the host minted no invite');
  const texts = new MemHost();
  texts.texts.set('notes.md', SEED);
  new SessionBridge({ engine: host, host: texts }).documentOpened('notes.md');
  await host.grant(['notes.md']);

  const url = pageUrlFor(invite);
  let peer;
  let local;
  try {
    peer = await launch({
      port: 9352,
      profile: `${SHOTS}/profiles-${TAG}/peer`,
      width: 1280,
      height: 900,
    });
    local = await launch({
      port: 9353,
      profile: `${SHOTS}/profiles-${TAG}/local`,
      width: 1280,
      height: 900,
    });

      await joinPage(peer, url, 'peer');
    const peerState = await peer.evaluate(DOM.state);
    check(
      'caret: the peer page opened the room document',
      DOM.read(peerState.viewText).includes('line 11'),
      peerState.viewText,
    );
    // The peer's caret onto line 11, where the owner's screenshot had it.
    const peerLine = await clickLine(peer, 11);
    console.log(`[caret] peer caret on the line at ${peerLine}`);

    await joinPage(local, url, 'local');
    const localState = await local.evaluate(DOM.state);
    check(
      'caret: the local page opened the room document',
      DOM.read(localState.viewText).includes('line 11'),
      localState.viewText,
    );
    // Go to the peer: the local caret lands exactly at the peer's own offset, so the
    // Enters below are pressed at the peer's position — the owner's reproduction.
    const row = await local.evaluate(
      `[...document.querySelectorAll('#roster li')].findIndex((li) => (li.querySelector('.name')?.textContent ?? '').includes('peer'))`,
    );
    check('caret: the peer is in the roster', row >= 0, `row ${row}`);
    await local.evaluate(
      `[...document.querySelectorAll('#roster li')][${row}].querySelectorAll('button')[0].click()`,
    );
    const landed = await waitFor(
      'the peer caret to be drawn on the peer line',
      async () => {
        const state = await local.evaluate(DOM.state);
        return state.badges.length > 0 ? state : undefined;
      },
      15_000,
    );
    console.log(`[caret] landed: ${JSON.stringify({ badges: landed.badges, bars: landed.caretBars })}`);
    check(
      'caret: one badge before typing, on the peer word',
      landed.badges.length === 1 && landed.badges[0].line === peerLine,
      `${JSON.stringify(landed.badges)} against the peer line at ${peerLine}`,
    );
    await local.shot(`${SHOTS}/${TAG}/caret-before-typing.png`);

    // Three Enters at the peer's own position, the owner's reproduction.
    await local.evaluate(DOM.focusEditor);
    for (let index = 0; index < 3; index += 1) {
      await local.pressKey('Enter', { code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await sleep(400);
    }
    // The peer's page walks with the room: its caret is where the room put it now.
    const peerNow = await waitFor(
      'the peer caret to move with the room',
      async () => {
        const state = await peer.evaluate(DOM.state);
        return state.caretTop !== peerLine ? state.caretTop : undefined;
      },
      15_000,
    );
    const typed = await local.evaluate(DOM.state);
    await local.shot(`${SHOTS}/${TAG}/caret-after-three-enters.png`);
    console.log(
      `[caret] after three Enters: ${JSON.stringify({
        badges: typed.badges,
        bars: typed.caretBars,
        peerCaret: peerNow,
      })}`,
    );
    check(
      'caret: one badge per peer after typing',
      typed.badges.length === 1,
      `${typed.badges.length} badges on ${JSON.stringify(typed.badges.map((badge) => badge.line))}`,
    );
    check(
      'caret: the caret bar stays on one line',
      typed.caretBars.length === 1,
      `${typed.caretBars.length} bars on ${JSON.stringify(typed.caretBars.map((bar) => bar.line))}`,
    );
    check(
      "caret: the badge is on the peer's own line",
      typed.badges.length === 1 && typed.badges[0].line === peerNow,
      `badge ${JSON.stringify(typed.badges.map((badge) => badge.line))} against the peer at ${peerNow}`,
    );

    // The next frame draws the same point again, wherever the room puts the peer.
    await clickLine(peer, 13);
    const moved = await waitFor(
      'the badge to follow the peer to the new line',
      async () => {
        const state = await local.evaluate(DOM.state);
        return state.badges.length === 1 && state.badges[0].line !== typed.badges[0].line ? state : undefined;
      },
      15_000,
    );
    await local.shot(`${SHOTS}/${TAG}/caret-after-cursor-move.png`);
    console.log(`[caret] after the peer moved: ${JSON.stringify({ badges: moved.badges, bars: moved.caretBars })}`);
    check(
      'caret: a fresh frame draws one point again',
      moved.badges.length === 1 && moved.caretBars.length === 1,
      `${JSON.stringify(moved.badges)} and ${JSON.stringify(moved.caretBars)}`,
    );
  } finally {
    await peer?.close();
    await local?.close();
    await host.disconnect();
  }
}

const mode = process.argv[2] ?? 'all';
if (!['ghost', 'caret', 'all'].includes(mode)) {
  throw new Error(`unsupported mode: ${mode} (ghost, caret or all)`);
}
const server = await serve();
try {
  if (mode === 'ghost' || mode === 'all') await ghostRooms();
  if (mode === 'caret' || mode === 'all') await caretRoom();
} finally {
  server.kill('SIGKILL');
}
console.log(`\n${lines.join('\n')}`);
console.log(`GHOST-CARET VERDICT: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
process.exit(failed === 0 ? 0 : 1);
