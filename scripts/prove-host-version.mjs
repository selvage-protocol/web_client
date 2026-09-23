/**
 * Live proof for the version a hosting page mints at (`PROTOCOL.md` §2, §10), in a real browser.
 *
 * Two servers, one page: a `selvaged` that seats both versions, and one started with
 * `--serve-version-1-only`. Against each, the host card is read out of the page the server serves —
 * whether the action is offered, and the sentence that stands where it is not — and every sentence
 * is compared with `hostRefusalSentence(hostDecision(meta, search))` computed from that server's own
 * live `/meta`, so the page's copy and the server's answer cannot drift apart without this failing.
 *
 * The button is pressed, too: an init script stands in for `showDirectoryPicker`, returning the
 * browser's *real* `FileSystemDirectoryHandle` for an origin-private directory, so everything after
 * the pick — the walk, the sealed mint, the share link — is the real API and the real engine. What
 * is stubbed is the dialog alone. That is what lets this proof check the one thing the card's copy
 * cannot: that the *mint* follows the decision. The room's own link is read back, and a page on a
 * server that seats both versions has to carry a fragment (`#k=…&h=…`, the sealed wire's keys)
 * while a page pinned to `selvage/1` has to carry none.
 *
 * Enter in the name field is pressed too, on both kinds of card, because it is the one act the node
 * suite cannot drive: the bundle wires its listeners onto the page's elements at import, and a test
 * environment with no DOM has nothing to dispatch a key at. On a card that cannot host, Enter is
 * the join — the invite path opens and the line says what the join is missing; on one that can, it
 * starts the room. Both are driven below, and both fail if the key stops reaching `runPrimary`.
 *
 * Three more cases come from the final review's findings, and each is a card state a person meets:
 * an origin answering `/meta` with JSON that is not a Selvage server's is offered nothing (M2); a
 * `/meta` that does not answer within the deadline keeps the offer, says what was not read, and is
 * asked again with a longer deadline (M1); and an origin that answers no JSON at all is the same
 * "not a Selvage server" the static case is. The first and the last are served from a real HTTP
 * server in front of the built bundle, the middle from a proxy that delays only `/meta` in front of
 * the real `selvaged`.
 *
 * The version-1 join of the last case is what the browser is asked for last: a room is minted from
 * this process with the engine the page bundles — as `prove-v2.mjs` does for its guest — and the
 * page served by the version-1-only server joins it from its own card, which is the half of "a page
 * there still joins, and cannot host unless it is pinned" a browser can be made to answer.
 *
 * Screenshots go to `.tmp/prove-host-version/`, inside the checkout, where the Chromium profile and
 * every artefact stay.
 *
 * Usage:
 *   node scripts/prove-host-version.mjs
 *   SELVAGE_SELVAGED=/path/to/selvaged SELVAGE_CHROMIUM=/path/to/chromium node scripts/prove-host-version.mjs
 */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import WebSocket from 'ws';

import { HOST_NEEDS_THE_SERVERS_PAGE, HOST_TAB_WARNING, HOST_UNREAD_NOTE, hostRefusalSentence } from '../src/browser/host.ts';
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

/**
 * A minimal HTTP server in front of the built bundle, for the two `/meta` an origin that is not a
 * Selvage server can answer: a JSON body that is not a Selvage `/meta` at all, and no JSON at all
 * (a 404, which is what a plain static host does). Every other path is the bundle, so the page is
 * fully wired and its decision is the one a real deployment's would be.
 */
async function startStaticPage(metaBody) {
  const root = resolve(ROOT, 'dist');
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
    '.map': 'application/json; charset=utf-8',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/meta') {
      if (metaBody === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('no meta here');
      } else {
        response.writeHead(200, { 'content-type': 'application/json' }).end(metaBody);
      }
      return;
    }
    const name = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = resolve(root, `.${name}`);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('no');
      return;
    }
    response.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });
  const port = await new Promise((resolve_, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve_(server.address().port));
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => {
      server.closeAllConnections?.();
      server.close();
    },
  };
}

/**
 * The real `selvaged`, behind a proxy that takes `metaDelayMs` to answer `/meta` and passes
 * everything else — including the WebSocket upgrade — straight through.
 *
 * This is the one shape a browser cannot be handed otherwise: the page *is* the server's own page
 * (the proxy is in front of the server), and `/meta` is slow rather than absent. A cold server, a
 * phone link or a proxy hiccup is this, and what the card does about it is what the review's M1
 * was about.
 */
async function startSlowMetaProxy(upstreamAddress, metaDelayMs) {
  const upstreamPort = Number(upstreamAddress.split(':')[1]);
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/meta')) {
      await delay(metaDelayMs);
    }
    const upstream = httpRequest(
      { host: '127.0.0.1', port: upstreamPort, path: request.url, method: request.method, headers: request.headers },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    upstream.on('error', () => response.writeHead(502).end('proxy'));
    request.pipe(upstream);
  });
  server.on('upgrade', (request, clientSocket, head) => {
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: upstreamPort,
      path: request.url,
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${upstreamPort}` },
    });
    upstream.on('upgrade', (answer, upstreamSocket, upstreamHead) => {
      clientSocket.write('HTTP/1.1 101 Switching Protocols\r\n');
      for (const [name, value] of Object.entries(answer.headers)) {
        for (const one of Array.isArray(value) ? value : [value]) {
          clientSocket.write(`${name}: ${one}\r\n`);
        }
      }
      clientSocket.write('\r\n');
      if (upstreamHead.length > 0) {
        clientSocket.write(upstreamHead);
      }
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstream.on('response', (answer) => {
      clientSocket.end(`HTTP/1.1 ${answer.statusCode ?? 502} refused\r\n\r\n`);
    });
    upstream.on('error', () => clientSocket.destroy());
    upstream.end(request.method === 'GET' || request.method === 'HEAD' ? undefined : head);
  });
  const port = await new Promise((resolve_, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve_(server.address().port));
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => {
      server.closeAllConnections?.();
      server.close();
    },
  };
}

/**
 * The picker's stand-in, added before any page script in every page this proof opens.
 *
 * `showDirectoryPicker` is the one thing automation cannot answer — the dialog belongs to the
 * browser — so this installs a picker that returns the *real* `FileSystemDirectoryHandle` for an
 * origin-private directory, seeded the way a project folder is: a text file, a nested file, and the
 * names the shared rule must leave out. Everything after the pick is the API itself.
 */
const PICKER_STAND_IN = `(() => {
  const build = async () => {
    const root = await navigator.storage.getDirectory();
    const project = await root.getDirectoryHandle('project', { create: true });
    const write = async (dir, name, text) => {
      const file = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await file.write(text);
      await file.close();
    };
    await write(project, 'notes.md', '# the browser host folder\\n');
    const sub = await project.getDirectoryHandle('sub', { create: true });
    await write(sub, 'readme.txt', 'nested\\n');
    await write(project, '.env', 'SECRET=1\\n');
    await write(project, 'logo.png', 'not really a png\\n');
    await write(await project.getDirectoryHandle('node_modules', { create: true }), 'x.js', 'module.exports = 1;\\n');
    return project;
  };
  window.showDirectoryPicker = () => build();
})();`;

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
  // Before any page script, in every document this browser opens: the picker's stand-in.
  await psend('Page.addScriptToEvaluateOnNewDocument', { source: PICKER_STAND_IN });

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

/**
 * The invite path and the line under Join: what Enter in the name field moves where the card
 * cannot host, and what it says about the join it was asked for.
 */
const JOIN_PATH = `(() => {
  const path = document.getElementById('invite-path');
  const error = document.getElementById('join-error');
  const note = document.getElementById('host-note');
  return {
    open: path === null ? null : path.open,
    error: error === null ? null : error.textContent ?? '',
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

/**
 * The card's name field, filled the way a person fills it: the value and the event that goes with
 * it. A refusal about the invite link is only reachable from here, since a blank name refuses
 * first.
 */
async function typeTheName(page, displayName) {
  await page.evaluate(`(() => {
    const name = document.getElementById('name');
    if (name === null) {
      throw new Error('the card has no name field');
    }
    if (name.value === '') {
      name.value = ${JSON.stringify(displayName)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return name.value;
  })()`);
}

/**
 * Enter in the name field, the way a person makes it: a keydown on the field the card focuses
 * itself.
 *
 * The bundle wires its own listeners at import, onto the page's elements, so this act cannot be
 * driven in the node suite — there is no DOM there and the module cannot be imported without one.
 * It is driven here instead: the key is dispatched for real, and the page's own listener taking it
 * (`preventDefault`, so the dispatch returns false) is what proves the wiring is live.
 */
async function enterInTheNameField(page) {
  return page.evaluate(`(() => {
    const name = document.getElementById('name');
    if (name === null) {
      throw new Error('the card has no name field');
    }
    name.focus();
    return name.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  })()`);
}

/**
 * The host's own act, made the way a person makes it: a name, and the button the start card
 * leads with. The picker behind it is the stand-in installed above, which answers with a real
 * directory handle; everything the page does with what it returns is the page's own code.
 */
async function hostFromTheCard(page, displayName) {
  const armed = await page.evaluate(`(() => {
    const name = document.getElementById('name');
    if (name !== null && name.value === '') {
      name.value = ${JSON.stringify(displayName)};
      name.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const button = document.getElementById('host-button');
    if (button === null || button.hidden) {
      return false;
    }
    button.click();
    return true;
  })()`);
  if (armed !== true) {
    throw new Error('the card offers no host action to press');
  }
}

/**
 * The session bar once the room is seated: the link the host hands on, whole.
 *
 * The bar shows an abbreviation and keeps the whole link in the field's title — and the title is
 * what carries the fragment, which is the whole question here.
 */
const SHARE = `(() => {
  const bar = document.getElementById('session');
  const share = document.getElementById('share');
  return {
    barHidden: bar === null ? null : bar.hidden,
    link: share === null ? '' : share.title || share.value || '',
    error: (document.getElementById('host-error')?.textContent ?? ''),
    note: (document.getElementById('host-note')?.textContent ?? ''),
  };
})()`;

/** Waits for the host's session bar to carry a link, which is the room this tab minted. */
function waitForShare(page, label) {
  return waitForRead(page, label, SHARE, (read) => read.barHidden === false && read.link !== '', 60_000);
}

/**
 * Every distinct card state over `steps * everyMs`, in order.
 *
 * The state of a card that answers on its own schedule — an offer shown while `/meta` is still
 * being asked, a note that a later read replaces — is the sequence, not the last frame: sampling
 * is what a proof of one has to record, and the deadline it runs under reports what it saw.
 */
async function sampleCard(page, { steps, everyMs }) {
  const seen = [];
  for (let step = 0; step < steps; step += 1) {
    const card = await page.evaluate(CARD);
    const last = seen[seen.length - 1];
    if (last === undefined || last.buttonHidden !== card.buttonHidden || last.note !== card.note) {
      seen.push({ atMs: step * everyMs, ...card });
    }
    await delay(everyMs);
  }
  return seen;
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

    // === The mint follows the decision: the button is pressed, and the room's own link is read.
    // Everything after the pick is the page's real code — the folder walk, the sealed mint, the
    // share bar — so this is the one check no reading of the card can make: a page on a server
    // that seats both versions mints an encrypted room (`§10`), whatever its card says.
    await chromium.navigate(`${both.origin}/`);
    await waitForCard(chromium, 'the card before the host press');
    await hostFromTheCard(chromium, 'Ada');
    const sealed = await waitForShare(chromium, 'the sealed room the unpinned page minted');
    log('the unpinned page minted', sealed.link);
    check('the unpinned page minted a room', sealed.link.includes('room='));
    check(
      'the unpinned page on a both-seated server minted a sealed room',
      sealed.link.includes('#k=') && sealed.link.includes('&h='),
    );
    check('the sealed room minted with no error on the card', sealed.error === '');
    await chromium.shot(resolve(IMAGES, 'both-seated-minted.png'));

    // === The same act, made from the name field on a page that does offer hosting: Enter runs the
    // action the card leads with, so the pin reaches the mint through the card's own field and the
    // key never falls through to silence. This is the half of `runPrimary` the button press above
    // cannot show.
    await chromium.navigate(`${oneOnly.origin}/?wire=1`);
    await waitForCard(chromium, 'the pinned card before the host act');
    await typeTheName(chromium, 'Ada');
    const pressed = await enterInTheNameField(chromium);
    check('the page\'s own Enter listener took the key on a page that can host', pressed === false);
    const readable = await waitForShare(chromium, 'the version-1 room the pinned page minted');
    log('the pinned page minted', readable.link);
    check('the pinned page minted a room', readable.link.includes('room='));
    check(
      'a page pinned to selvage/1 minted a version-1 room, with no fragment at all',
      !readable.link.includes('#'),
    );
    check('the version-1 room minted with no error on the card', readable.error === '');
    await chromium.shot(resolve(IMAGES, 'one-only-pinned-minted.png'));

    // === M2: an origin that answers `/meta` with JSON that is not a Selvage server's is offered
    // nothing, and never a button whose only outcome is a refusal deeper in.
    const stub = await startStaticPage('{}');
    try {
      const body = await (await fetch(`${stub.origin}/meta`)).json();
      log('the stub origin answers /meta with', JSON.stringify(body));
      await chromium.navigate(`${stub.origin}/`);
      const stubCard = await waitForCard(chromium, 'the card on an origin that answers {}');
      check('an origin answering {} is not offered the host action', stubCard.buttonHidden === true);
      check(
        'an origin answering {} gets the not-a-Selvage-server sentence',
        stubCard.note === HOST_NEEDS_THE_SERVERS_PAGE,
      );
      // === And the other act on this card: Enter in the name field is the card's own action, and
      // where the card cannot host that action is the join — the invite path opens under the field
      // and the join's own line says what it is missing, while the reason hosting is not offered
      // stays standing beside it. Driven here rather than in the node suite, which has no DOM to
      // dispatch the key at.
      await typeTheName(chromium, 'Ada');
      const taken = await enterInTheNameField(chromium);
      check('the page\'s own Enter listener took the key', taken === false);
      const entered = await waitForRead(
        chromium,
        'Enter to reach the invite path',
        JOIN_PATH,
        (read) => read.open === true,
      );
      check('Enter in the name field opens the invite path where the card cannot host', entered.open === true);
      check(
        '  and the join says what it is missing',
        entered.error === 'Paste an invite link to join.',
      );
      check(
        '  while the reason hosting is not offered still stands',
        entered.note === HOST_NEEDS_THE_SERVERS_PAGE,
      );
      await chromium.shot(resolve(IMAGES, 'stub-json-meta.png'));
    } finally {
      stub.stop();
    }

    // === And an origin that answers no JSON at all — a plain static host, which is what
    // `npm run serve` is — reads the same way.
    const staticHost = await startStaticPage(undefined);
    try {
      const status = (await fetch(`${staticHost.origin}/meta`)).status;
      log('the static origin answers /meta with', status);
      await chromium.navigate(`${staticHost.origin}/`);
      const staticCard = await waitForCard(chromium, 'the card on a static host');
      check('a static host is not offered the host action', staticCard.buttonHidden === true);
      check(
        'a static host gets the not-a-Selvage-server sentence',
        staticCard.note === HOST_NEEDS_THE_SERVERS_PAGE,
      );
    } finally {
      staticHost.stop();
    }

    // === M1: the server's own page, with a `/meta` slower than the card's first deadline. The
    // offer has to survive it, the card has to say what it could not read, and the second ask has
    // to put the truth on the card — and at no point may it say this page is not a Selvage
    // server's, which is what it used to say about the server's own page.
    const slow = await startSlowMetaProxy(both.wsBase.split('//')[1], 3000);
    try {
      const slowMeta = await fetch(`${slow.origin}/meta`).then(async (answer) => answer.json());
      check(
        'the slow origin is the real server, behind a slow /meta',
        JSON.stringify(slowMeta.wire_versions) === JSON.stringify(bothMeta.wire_versions),
      );
      await chromium.navigate(`${slow.origin}/`);
      const samples = await sampleCard(chromium, { steps: 130, everyMs: 100 });
      log('the card over the slow /meta:', JSON.stringify(samples));
      // From the frame the card is decided in: the frames before it are the card's own markup,
      // which offers nothing to anybody.
      const decided = samples.filter((sample) => sample.wrapHidden === false);
      check('the card was decided while /meta was still being asked', decided.length > 0);
      check(
        'the offer is never withdrawn for a /meta that was slow',
        decided.every((sample) => sample.buttonHidden === false),
      );
      check(
        'the slow page is never called one that is not a Selvage server\'s',
        samples.every((sample) => sample.note !== HOST_NEEDS_THE_SERVERS_PAGE),
      );
      check(
        'the card says what it could not read while it has not read it',
        samples.some((sample) => sample.note === HOST_UNREAD_NOTE),
      );
      check(
        'the second ask puts the server\'s own warning back on the card',
        samples.at(-1).note === HOST_TAB_WARNING,
      );
      await chromium.shot(resolve(IMAGES, 'slow-meta-offered.png'));
    } finally {
      slow.stop();
    }

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
        'a sentence where it does not, the pin honoured both ways and at the mint, nothing offered on ' +
        'an origin that is not a Selvage server, the offer kept through a slow /meta, Enter reaching ' +
        'both halves of the card\'s own action, and a version-1 join still reached',
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
