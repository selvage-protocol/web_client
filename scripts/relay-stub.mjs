/**
 * A minimal Selvage endpoint, for the one case where the relay's proof cannot use the
 * real thing.
 *
 * `scripts/container-smoke.sh` runs the page image with `SELVAGE_SERVER=selvaged:8080`
 * against `ghcr.io/selvage-protocol/selvaged:latest`, because a relay is only worth
 * anything in front of the server it is for. Where that image cannot be pulled — no
 * route to `ghcr.io`, a rate limit — the same assertions run against this process
 * instead: `/meta` with a Selvage body, and a WebSocket that seats a room, in the shape
 * `scripts/check-relay.mjs` asserts.
 *
 * **This proves the relay and not the server.** Whether `selvaged` serves those two
 * paths, what its `/meta` carries and the wire version it speaks are the other
 * repository's own tests; the banner the smoke prints names which counterpart ran, and
 * the `server` member below says `selvaged/stub` so a transcript cannot be misread.
 *
 *   STUB_PORT=18082 node scripts/relay-stub.mjs
 *
 * Deliberately no more than the checker reaches: one hello per connection, the mint and
 * the join it needs, the `peer.joined` announcement the join produces. No document
 * relay, no awareness, no ping, no capacity bound.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.STUB_PORT ?? 8080);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WIRE = 'selvage/2';

const META = JSON.stringify({
  capabilities: ['y-protocols/1', 'awareness'],
  keepalive: {
    awareness_expire_ms: 30000,
    awareness_renew_ms: 10000,
    ping_interval_ms: 30000,
    room_grace_ms: 30000,
  },
  server: 'selvaged/stub',
  wire_versions: [WIRE],
});

const rooms = new Map();

function reply(socket, text) {
  const body = Buffer.from(text, 'utf8');
  const head = body.length < 126
    ? Buffer.from([0x81, body.length])
    : Buffer.concat([
      Buffer.from([0x81, 126]),
      Buffer.from([body.length >> 8, body.length & 0xff]),
    ]);
  socket.write(Buffer.concat([head, body]));
}

function answer(peer, value) {
  reply(peer.socket, JSON.stringify({ id: 1, v: WIRE, ...value }));
}

function seat(peer, hello) {
  const name = hello?.params?.display_name ?? 'peer';
  peer.name = name;
  if (peer.room === null) {
    const room = randomBytes(6).toString('hex');
    const token = randomBytes(16).toString('hex');
    const peers = new Set([peer]);
    rooms.set(room, { token, peers });
    peer.room = room;
    answer(peer, {
      event: 'room.created',
      params: {
        room_id: room,
        token,
        capabilities: ['y-protocols/1', 'awareness'],
        peers: [],
        self: { peer_id: peer.id, display_name: name },
      },
    });
    return;
  }
  const held = rooms.get(peer.room);
  if (held === undefined || held.token !== peer.token) {
    answer(peer, {
      error: { code: 'room.unknown', message: 'no room here carries that token' },
    });
    return;
  }
  const others = [...held.peers];
  held.peers.add(peer);
  answer(peer, {
    event: 'room.joined',
    params: {
      room_id: peer.room,
      peers: others.map((other) => ({ peer_id: other.id, display_name: other.name })),
      self: { peer_id: peer.id, display_name: name },
    },
  });
  const announcement = JSON.stringify({
    id: 0,
    v: WIRE,
    event: 'peer.joined',
    params: { room_id: peer.room, peer: { peer_id: peer.id, display_name: name } },
  });
  for (const other of others) reply(other.socket, announcement);
}

function handle(peer, opcode, payload) {
  if (opcode === 0x8) {
    peer.socket.end();
    return;
  }
  if (opcode === 0x9) {
    peer.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
    return;
  }
  if (opcode !== 0x1 && opcode !== 0x0) return;
  peer.frames += 1;
  if (peer.frames > 1) return;
  let hello = null;
  try {
    hello = JSON.parse(payload.toString('utf8'));
  } catch {
    answer(peer, { error: { code: 'bad_message', message: 'not JSON' } });
    return;
  }
  seat(peer, hello);
}

/** One client frame at a time, which is all a client that sends one hello needs. */
function drain(peer) {
  for (;;) {
    const held = peer.buffer;
    if (held.length < 2) return;
    const opcode = held[0] & 0x0f;
    const masked = (held[1] & 0x80) !== 0;
    let length = held[1] & 0x7f;
    let at = 2;
    if (length === 126) {
      if (held.length < 4) return;
      length = held.readUInt16BE(2);
      at = 4;
    } else if (length === 127) {
      if (held.length < 10) return;
      length = Number(held.readBigUInt64BE(2));
      at = 10;
    }
    const mask = masked ? held.subarray(at, at + 4) : null;
    if (masked) at += 4;
    if (held.length < at + length) return;
    const raw = held.subarray(at, at + length);
    const payload = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i += 1) {
      payload[i] = mask === null ? raw[i] : raw[i] ^ mask[i % 4];
    }
    peer.buffer = held.subarray(at + length);
    handle(peer, opcode, payload);
  }
}

const server = createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'application/json' });
    response.end('{"error":"method not allowed"}');
    return;
  }
  if (path === '/meta') {
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(META),
    });
    response.end(request.method === 'HEAD' ? undefined : META);
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end('{"error":"not found"}');
});

server.on('upgrade', (request, socket) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const key = request.headers['sec-websocket-key'];
  if (url.pathname !== '/session' || typeof key !== 'string') {
    socket.end('HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\n\r\n');
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'upgrade: websocket\r\n'
    + 'connection: Upgrade\r\n'
    + `sec-websocket-accept: ${createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`,
  );
  const peer = {
    socket,
    id: randomBytes(6).toString('hex'),
    name: 'peer',
    buffer: Buffer.alloc(0),
    frames: 0,
    room: url.searchParams.get('room'),
    token: url.searchParams.get('token'),
  };
  socket.on('data', (chunk) => {
    peer.buffer = Buffer.concat([peer.buffer, chunk]);
    drain(peer);
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    const held = peer.room === null ? undefined : rooms.get(peer.room);
    held?.peers.delete(peer);
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`relay stub: selvage/stub endpoint on 0.0.0.0:${port} (/meta and /session)`);
});
