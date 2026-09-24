// Minimal CDP driver: launch nix-store Chromium headless, drive via raw WebSocket.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/nix/store/33pxss8h71cl7vmfpy21bidsw0lj1g8q-chromium-152.0.7977.82/bin/chromium';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Chrome scratch belongs in the checkout: `/tmp` is RAM-backed on this host, and `.tmp/` is
 * ignored and removed with the run. Both paths are relative and the browser is spawned with the
 * checkout as its working directory, because the path of Chromium's process-singleton socket is
 * bounded at about 108 bytes — an absolute `.tmp/…` under a worktree is past it (`prove-v2.mjs`
 * carries the long form of this). Both are arguments, and `SELVAGE_CHROMIUM_TMPDIR` is the
 * environment's own answer for the socket directory, so a caller that wants another passes one.
 */
export async function launch({ port = 9333, profile = '.tmp/chromium/cdp', width = 1280, height = 900 } = {}) {
  profile = `${profile}-${Date.now()}`;
  mkdirSync(resolve(ROOT, profile), { recursive: true });
  const tmp = process.env['SELVAGE_CHROMIUM_TMPDIR'] ?? '.tmp/chromium';
  const browser = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: tmp } });
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for DevTools url')), 20000);
    let buf = '';
    browser.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    browser.on('exit', (c) => reject(new Error(`browser exited ${c}: ${buf.slice(-500)}`)));
  });
  const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
    } else if (msg.method) {
      const arr = listeners.get(msg.method);
      if (arr) for (const fn of arr) fn(msg.params);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  // Attach to the first page target
  const { targetInfos } = await send('Target.getTargets');
  const pageTarget = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true });
  const psend = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const cdp = {
    browser, ws, send, psend, on,
    close: async () => {
      try { ws.close(); } catch {}
      try { browser.kill('SIGKILL'); } catch {}
    },
    evaluate: async (expr, opts = {}) => {
      const { awaitPromise = true } = opts ?? {};
      const r = await psend('Runtime.evaluate', {
        expression: expr, awaitPromise, returnByValue: true, userGesture: true,
      });
      if (r.exceptionDetails) throw new Error(`eval threw: ${JSON.stringify(r.exceptionDetails).slice(0, 800)}`);
      return r.result?.value;
    },
    navigate: async (url) => {
      await psend('Page.enable');
      const loaded = new Promise((res) => {
        const h = (p) => { if (p?.frameId) { /* any load */ } };
        const h2 = () => {};
        listeners.set('Page.loadEventFired', [...(listeners.get('Page.loadEventFired') ?? []), () => res()]);
      });
      await psend('Page.navigate', { url });
      await Promise.race([loaded, new Promise((res) => setTimeout(res, 8000))]);
      await new Promise((res) => setTimeout(res, 1200));
    },
    shot: async (path) => {
      const { data } = await psend('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    key: async (key, { code, text } = {}) => {
      const keyDef = { type: key === 'keyDown' || key === 'keyUp' ? key : undefined };
      // simplified: press via Input.dispatchKeyEvent raw
      throw new Error('use pressKey');
    },
  };
  // raw key press helper
  cdp.pressKey = async (key, { code = undefined, text = undefined, type = undefined } = {}) => {
    const t = type ?? (text !== undefined ? 'char' : 'rawKeyDown');
    await psend('Input.dispatchKeyEvent', { type: t, key, code, text, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined });
    if (t === 'rawKeyDown' && text === undefined) await psend('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  };
  cdp.typeText = async (text) => { await psend('Input.insertText', { text }); };
  cdp.setViewport = async (width, height) => {
    await psend('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await cdp.sleep(700);
  };
  return cdp;
}
