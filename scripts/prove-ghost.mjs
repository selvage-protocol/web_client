/**
 * Live proof of the empty room, in a real browser: a keystroke with no document in front of the
 * editor must not land, and the room must not be told one was typed.
 *
 * The defect the owner reported is the ghost document. A room whose host has shared nothing, and a
 * room whose host has shared a listing with nothing opened from it, both leave the editor standing
 * over nothing: it looks like a file and is not one, and what a person types into it must be
 * refused by the page rather than published to the room. The way out is the room's own row in the
 * tree, and the last check is that pressing it puts text back in reach.
 *
 * What runs where, and why. The **page** is a real Chromium: what an empty room does with a
 * keystroke is a fact about the rendered page rather than about a module. The **room** is this
 * process, hosting with the engine the page drives (`src/engine` and `src/bridge`): a host that
 * shares a listing and never opens a document in a browser, which is the one state a page cannot be
 * driven into by hand.
 *
 * The server is one origin: `selvaged --serve-page dist` answers `/` with the built page and
 * `/session` with the room, on an ephemeral loopback port, so the page's own origin is the server
 * the invite names (`PROTOCOL.md` §5.1's shape, with no second server to point at).
 *
 * Screenshots and the browsers' profiles go to `.tmp/prove-ghost/` — inside the checkout, where
 * `/tmp` is never used, and ignored by git, which keeps a run from leaving anything in the tree.
 *
 * Usage:
 *   npm run build   # the server serves dist/, and refuses without it
 *   node scripts/prove-ghost.mjs
 *   SELVAGE_CHROMIUM=/path/to/chromium SELVAGE_SELVAGED=/path/to/selvaged node scripts/prove-ghost.mjs
 *
 * Every check is reported, not only the first that failed, and the run exits non-zero if any
 * missed: a proof that stopped at the first miss could not say whether the rest of the page holds.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import WebSocket from 'ws';

import { PeerEngine } from '../src/bridge/index.ts';
import { listingSource, pageEngine } from '../src/browser/relay.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = resolve(ROOT, '.tmp', 'prove-ghost');

function log(...parts) {
  console.log('[prove-ghost]', ...parts);
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
    .map((match) => ({ version: match[1], path: resolve(store, match[0], 'bin', 'chromium') }))
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
 * The smallest CDP driver this proof needs: one page, evaluate, typing and a screenshot.
 *
 * The debugging port is `0`, so the browser takes a free one of its own whatever else is running,
 * and the profile under `.tmp/` is what keeps runs apart.
 */
async function launch(name, { width = 1280, height = 900 } = {}) {
  const profile = `${relative(ROOT, resolve(SHOTS, 'profiles', name))}-${Date.now()}`;
  mkdirSync(resolve(ROOT, profile), { recursive: true });
  // Chromium puts its process-singleton socket under `TMPDIR`, and the path it hands the kernel is
  // bounded at about 108 bytes: the browser's `TMPDIR` is relative and it is spawned with the
  // checkout as its working directory, so the socket stays inside the checkout and inside the bound
  // (`prove-v2.mjs` carries the long form of this).
  const tmp = process.env['SELVAGE_CHROMIUM_TMPDIR'] ?? '.tmp/chromium';
  // Chromium creates the profile but not the socket directory inside `TMPDIR`, and refuses to start
  // without one.
  mkdirSync(resolve(ROOT, tmp), { recursive: true });
  const browser = spawn(chromiumBinary(), [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: tmp } });
  // Everything from the spawn to the returned handle is inside this guard: the caller gets no
  // handle when a step here throws, and a Chromium left behind by a rejection is a proof that
  // hangs — and one whose profile the next run cannot use.
  let ws;
  try {
    const wsUrl = await new Promise((resolved, rejected) => {
      const timer = setTimeout(() => rejected(new Error('timed out waiting for DevTools url')), 20_000);
      let buf = '';
      browser.stderr.on('data', (data) => {
        buf += data.toString();
        const match = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolved(match[1]);
        }
      });
      browser.on('error', (error) => {
        clearTimeout(timer);
        rejected(new Error(`chromium could not be started: ${error.message}`));
      });
      browser.on('exit', (code) => {
        clearTimeout(timer);
        rejected(new Error(`browser exited ${code}: ${buf.slice(-500)}`));
      });
    });
    ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise((resolved, rejected) => {
      ws.on('open', resolved);
      ws.on('error', rejected);
    });
    let nextId = 1;
    const pending = new Map();
    const listeners = new Map();
    /**
     * One CDP call, on a deadline. A request that is never answered — a browser that went away, a
     * `Runtime.evaluate` a page never returns from — fails here rather than holding the proof at
     * zero CPU, and the error names the call that stalled.
     */
    const request = (method, params = {}, session) => new Promise((resolved, rejected) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.delete(id)) rejected(new Error(`no answer to CDP ${method} in 20s`));
      }, 20_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolved(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejected(error);
        },
      });
      try {
        ws.send(JSON.stringify({ id, method, params, ...(session === undefined ? {} : { sessionId: session }) }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        rejected(error);
      }
    });
    /** Whatever is still waiting when the socket goes is answered as that, without the deadline. */
    const failWaiting = (error) => {
      for (const waiting of [...pending.values()]) waiting.reject(error);
      pending.clear();
    };
    ws.on('close', () => failWaiting(new Error('the CDP socket closed')));
    ws.on('error', (error) => failWaiting(error));
    const on = (method, fn) => {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    };
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id !== undefined) {
        const waiting = pending.get(msg.id);
        if (waiting) {
          pending.delete(msg.id);
          if (msg.error) waiting.reject(new Error(JSON.stringify(msg.error)));
          else waiting.resolve(msg.result);
        }
      } else if (msg.method) {
        for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
    // Attach to the first page target: the browser was launched on `about:blank`.
    const { targetInfos } = await request('Target.getTargets');
    const pageTarget = targetInfos.find((target) => target.type === 'page');
    const { sessionId } = await request('Target.attachToTarget', {
      targetId: pageTarget.targetId,
      flatten: true,
    });
    const psend = (method, params = {}) => request(method, params, sessionId);
    return {
      on,
      close: async () => {
        try {
          ws.close();
        } catch {}
        try {
          browser.kill('SIGKILL');
        } catch {}
      },
      evaluate: async (expression, { awaitPromise = true } = {}) => {
        const result = await psend('Runtime.evaluate', {
          expression,
          awaitPromise,
          returnByValue: true,
          userGesture: true,
        });
      if (result.exceptionDetails) {
        throw new Error(`eval threw: ${JSON.stringify(result.exceptionDetails).slice(0, 800)}`);
      }
      return result.result?.value;
    },
    /** A navigation, waited on its load event or on a bounded deadline, then left to settle. */
    navigate: async (url) => {
      const loaded = new Promise((done) => on('Page.loadEventFired', () => done()));
      await psend('Page.enable');
      await psend('Page.navigate', { url });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(1200);
    },
    shot: async (path) => {
      const { data } = await psend('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    typeText: async (text) => {
      await psend('Input.insertText', { text });
    },
  };
  } catch (error) {
    try {
      ws?.close();
    } catch {}
    browser.kill('SIGKILL');
    throw error;
  }
}

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

/** `selvaged` serving the built page, page and socket on one origin and an ephemeral port. */
async function serve() {
  const page = resolve(ROOT, 'dist');
  if (!existsSync(resolve(page, 'index.html'))) {
    throw new Error('dist/index.html is missing; run `npm run build` first');
  }
  const child = spawn(
    selvagedBinary(),
    ['--listen', '127.0.0.1:0', '--serve-page', page, '--room-grace-ms', '120000'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } },
  );
  child.stderr.on('data', (data) => process.stderr.write(`[selvaged] ${data}`));
  // A server that never reports an address, or a page that never answers, is stopped before this
  // function throws: the caller has no handle on it yet.
  try {
    const address = await new Promise((resolved, rejected) => {
      let stdout = '';
      const timer = setTimeout(() => rejected(new Error('selvaged did not report an address in 10s')), 10_000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        const match = /ws:\/\/([0-9.]+:[0-9]+)\/session/.exec(stdout);
        if (match !== null) {
          clearTimeout(timer);
          resolved(match[1]);
        }
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        rejected(new Error(`selvaged could not be started: ${error.message}`));
      });
      child.on('exit', () => {
        clearTimeout(timer);
        rejected(new Error('selvaged exited before it was ready'));
      });
    });
    const origin = `http://${address}`;
    await waitFor(
      'the page to be served',
      async () => {
        try {
          const response = await fetch(`${origin}/`);
          return response.ok ? true : undefined;
        } catch {
          return undefined;
        }
      },
      20_000,
    );
    return { origin, wsBase: `ws://${address}`, stop: () => child.kill('SIGKILL') };
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

/** The page URL for a room's invite, as a guest's link. The page is served from
 * the same origin as the server, so the link's origin is the server it names. */
function pageUrlFor(origin, invite) {
  const url = new URL(invite);
  const query = new URLSearchParams({
    room: url.searchParams.get('room') ?? '',
    token: url.searchParams.get('token') ?? '',
  });
  // `§5.1`'s fragment is the room key and the host key, and the page reads a room from it:
  // a page URL without one is a join the engine refuses.
  return `${origin}/?${query.toString()}${url.hash}`;
}

const DOM = {
  /** The page's readable state, for the driver's checks and its own log. */
  state: `({
    tree: document.querySelector('#tree').textContent,
    viewText: document.querySelector('#editor .view-lines').innerText,
    faces: [...document.querySelectorAll('#faces .av')].map((face) => face.getAttribute('aria-label')),
  })`,
  focusEditor: `(() => {
    const area = document.querySelector('.monaco-editor textarea.inputarea');
    if (area) area.focus();
    return document.activeElement === area;
  })()`,
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
async function ghostRooms(server) {
  // (a) The room shares nothing at all: no granted path, no open document.
  const emptyHost = pageEngine(
    await PeerEngine.host({
      baseUrl: server.wsBase,
      displayName: 'empty-host',
      listing: listingSource([]),
      client: 'prove-ghost/host',
    }),
  );
  // (b) The room lists a file but has nothing open. `§7.1` seals the state from the listing, so
  // the listing is what the mint is handed.
  const listedHost = pageEngine(
    await PeerEngine.host({
      baseUrl: server.wsBase,
      displayName: 'listed-host',
      listing: listingSource(['todo.txt']),
      client: 'prove-ghost/host',
    }),
  );
  const listedInvite = listedHost.inviteUrl();

  let cdp;
  try {
    cdp = await launch('ghost');
    cdp.on('Runtime.exceptionThrown', (params) =>
      log(`EXC ${JSON.stringify(params.exceptionDetails).slice(0, 300)}`),
    );

    for (const [label, host, invite] of [
      ['no-listing', emptyHost, emptyHost.inviteUrl()],
      ['listing-no-open-document', listedHost, listedInvite],
    ]) {
      if (invite === undefined) throw new Error(`${label}: the host minted no invite`);
      await joinPage(cdp, pageUrlFor(server.origin, invite), `guest-${label}`);
      const state = await cdp.evaluate(DOM.state);
      log(
        `[ghost ${label}] state ${JSON.stringify({
          tree: state.tree,
          viewText: state.viewText,
          documents: host.session().documents,
        })}`,
      );
      check(
        `ghost/${label}: the tree says where the room stands`,
        label === 'no-listing'
          ? state.tree.includes('The host has not shared any files yet.')
          : state.tree.includes('todo.txt'),
        state.tree,
      );
      await cdp.shot(`${SHOTS}/ghost-${label}-before-typing.png`);
      // The person types into what looks like a file: it must not land. The editor is asked for
      // focus first, and a room that refuses it is reported as that — a keystroke into a page that
      // never had focus would prove nothing about the keystroke.
      //
      // `Input.insertText` is the one input path this proof can drive. A dispatched Enter is not:
      // measured on this page and Chromium 154, `char` with `text: '\r'`, `keyDown` with the same
      // text, and a `rawKeyDown`/`keyUp` pair all leave the model as they found it, while
      // `insertText` lands. The check on the opened file below is the positive control for the
      // path this one uses.
      const focused = await cdp.evaluate(DOM.focusEditor);
      check(
        `ghost/${label}: the editor takes focus`,
        focused === true,
        `focusEditor returned ${JSON.stringify(focused)}`,
      );
      await cdp.typeText('ghost text nobody sees');
      await sleep(600);
      const after = await cdp.evaluate(DOM.state);
      await cdp.shot(`${SHOTS}/ghost-${label}-after-typing.png`);
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
        // The positive control for the input path the empty-room check uses: the same
        // `insertText` that must not land there lands here.
        const opened = await waitFor(
          'the opened file to take text',
          async () => {
            await cdp.typeText('x');
            const state = await cdp.evaluate(DOM.state);
            return state.viewText.includes('x') ? state : undefined;
          },
          15_000,
        );
        await cdp.shot(`${SHOTS}/ghost-listing-opened-takes-text.png`);
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

async function main() {
  // The shots live inside the checkout, and every path the browser writes takes its profile from
  // here, so the directory is made before the launch.
  mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  log('serving', server.origin);
  try {
    await ghostRooms(server);
  } finally {
    // Whatever happened — a room that minted no invite, a page that timed out, a browser that would
    // not launch — the server goes with this process: a `selvaged` left behind is a proof that hangs
    // after the error instead of exiting.
    server.stop();
  }
}

let ranToTheEnd = true;
try {
  await main();
} catch (error) {
  ranToTheEnd = false;
  check('the proof ran to the end', false, error instanceof Error ? error.message : String(error));
}
log(`\n${lines.join('\n')}`);
log(`wrote ${relative(ROOT, SHOTS)}/`);
if (ranToTheEnd) log('an empty room took no keystroke, and told the room nothing of one');
log(`GHOST VERDICT: ${failed === 0 ? 'PASS' : `FAIL (${failed})`}`);
process.exitCode = failed === 0 ? 0 : 1;
