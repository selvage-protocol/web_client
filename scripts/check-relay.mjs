/**
 * The relay proof: `/meta`, the WebSocket upgrade and a seated room, read at the page's
 * own origin.
 *
 *   node scripts/check-relay.mjs <base-url>
 *
 * `scripts/container-smoke.sh` runs the page image with `SELVAGE_SERVER` naming a server
 * and then runs this against the port the page publishes. Three things the relay's whole
 * point is made of have to hold at once there: `/meta` answers a Selvage body — a JSON
 * document whose `wire_versions` carries `selvage/2`, which is what the browser's
 * advisory read is for — on the same host and port that serves `/` (one origin, not a
 * page beside the room); and the socket upgrade through `/session` completes with `101`
 * rather than the page's 404 or a 502, and *seats*: one connection mints a room, a second
 * joins it through that same relay, and the first hears `peer.joined`.
 *
 * Every read is bounded and reports what it was waiting for, so a relay that answers
 * nothing fails here rather than hanging the smoke.
 */
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (base === '') {
  console.error('usage: node scripts/check-relay.mjs <base-url>');
  process.exit(2);
}
if (typeof WebSocket !== 'function') {
  console.error('check-relay.mjs needs the WebSocket global, which Node 22 and newer have');
  process.exit(2);
}
const waitMs = Number(process.env.RELAY_CHECK_WAIT_MS ?? 15000);
const wire = 'selvage/2';
const origin = new URL(base);
const wsBase = `ws://${origin.host}`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function get(path, what) {
  let response;
  try {
    response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(waitMs) });
  } catch (error) {
    fail(`${what}: ${base}${path} did not answer within ${waitMs}ms (${error.message})`);
  }
  return { status: response.status, headers: response.headers, body: await response.text() };
}

/** A socket that yields one event at a time, with the deadline on the wait. */
function connect(url) {
  const ws = new WebSocket(url);
  const frames = [];
  const waiters = [];
  const settle = () => {
    while (waiters.length > 0 && frames.length > 0) waiters.shift()();
  };
  ws.addEventListener('message', (event) => {
    let frame = { raw: true };
    if (typeof event.data === 'string') {
      try {
        frame = JSON.parse(event.data);
      } catch {
        frame = { raw: true };
      }
    }
    frames.push(frame);
    settle();
  });
  ws.addEventListener('close', () => {
    frames.push(null);
    settle();
  });
  return {
    opened: new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', () => reject(new Error(`${url} refused the upgrade`)));
    }),
    send(value) {
      ws.send(JSON.stringify(value));
    },
    async event(named) {
      for (;;) {
        if (frames.length === 0) {
          await new Promise((resolve, reject) => {
            waiters.push(resolve);
            setTimeout(
              () => reject(new Error(`no ${named} within ${waitMs}ms`)),
              waitMs,
            ).unref();
          });
        }
        const frame = frames.shift();
        if (frame === null) fail(`the socket to ${url} closed while waiting for ${named}`);
        if (frame?.event === named) return frame;
      }
    },
    close() {
      ws.close();
    },
  };
}

/** The upgrade as a plain HTTP request, so the status line itself is readable. */
function upgrade() {
  const request = new URL(`${base}/session`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('the upgrade was not answered within the deadline')),
      waitMs,
    );
    const client = httpRequest({
      host: request.hostname,
      port: request.port,
      path: request.pathname,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
      },
    });
    client.on('upgrade', (response) => {
      clearTimeout(timer);
      response.socket.destroy();
      resolve(response.statusCode);
    });
    client.on('response', (response) => {
      clearTimeout(timer);
      response.resume();
      reject(new Error(`/session answered ${response.statusCode}, not an upgrade`));
    });
    client.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    client.end();
  });
}

function hello(name) {
  return { id: 1, method: 'session.hello', params: { display_name: name }, v: wire };
}

const meta = await get('/meta', 'the relayed /meta read');
if (meta.status !== 200) {
  fail(`/meta answered ${meta.status} through the relay, want 200`);
}
if (!(meta.headers.get('content-type') ?? '').includes('application/json')) {
  fail(`/meta answered content-type ${meta.headers.get('content-type')}, want a JSON body`);
}
let body;
try {
  body = JSON.parse(meta.body);
} catch {
  fail(`/meta answered a body that is not JSON: ${meta.body.slice(0, 120)}`);
}
if (typeof body.server !== 'string' || !body.server.startsWith('selvaged/')) {
  fail(`/meta answered server ${JSON.stringify(body.server)}, which is not a Selvage server`);
}
if (!Array.isArray(body.wire_versions) || !body.wire_versions.includes(wire)) {
  fail(`/meta advertises wire_versions ${JSON.stringify(body.wire_versions)}, want ${wire} among them`);
}
if (!Array.isArray(body.capabilities)) {
  fail(`/meta advertises capabilities ${JSON.stringify(body.capabilities)}, want a list`);
}
console.log(`meta ok: ${body.server} via ${base}/meta, ${wire}, content-type application/json`);

const page = await get('/', 'the page');
if (page.status !== 200 || !/^\s*<!doctype html/i.test(page.body)) {
  fail(`${base}/ answered ${page.status} without the page's own shell, so the relay is not one origin with the page`);
}
console.log(`one origin: ${base}/ is the page and /meta is the relayed server's`);

const status = await upgrade().catch((error) => fail(`the /session upgrade failed: ${error.message}`));
if (status !== 101) fail(`/session answered ${status} to an upgrade, want 101`);
console.log('upgrade ok: /session answered 101 through the relay');

const host = connect(`${wsBase}/session`);
await host.opened.catch((error) => fail(`the host socket failed: ${error.message}`));
host.send(hello('relay-host'));
const created = await host.event('room.created');
const room = created?.params?.room_id;
const token = created?.params?.token;
if (typeof room !== 'string' || room === '' || typeof token !== 'string' || token === '') {
  fail(`room.created carried room_id ${JSON.stringify(room)} and token ${JSON.stringify(token)}`);
}

const guest = connect(`${wsBase}/session?room=${room}&token=${token}`);
await guest.opened.catch((error) => fail(`the guest socket failed: ${error.message}`));
guest.send(hello('relay-guest'));
const joined = await guest.event('room.joined');
if (joined?.params?.room_id !== room) {
  fail(`the guest was seated in ${JSON.stringify(joined?.params?.room_id)}, not the room it was handed`);
}
const announced = await host.event('peer.joined');
if (typeof announced?.params?.peer?.peer_id !== 'string') {
  fail(`the host heard ${JSON.stringify(announced)}, which announces no peer`);
}
host.close();
guest.close();
console.log(`room ok: ${room} minted on ${wsBase}/session and joined through the relay, the host hearing peer.joined`);

console.log(`relay OK: ${base} relays /meta and /session to a Selvage server and seats a room there`);
