// Minimal CDP driver: launch nix-store Chromium headless, drive via raw WebSocket.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const CHROME = '/nix/store/33pxss8h71cl7vmfpy21bidsw0lj1g8q-chromium-152.0.7977.82/bin/chromium';

export async function launch({ port = 9333, profile = '/tmp/selvage-guest-profile', width = 1280, height = 900 } = {}) {
  profile = `${profile}-${Date.now()}`;
  const browser = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
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
