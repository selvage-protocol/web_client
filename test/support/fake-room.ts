/**
 * An in-process `selvage/2` room, for the browser composed tests.
 *
 * The page's adapter (`MonacoBinding`), the bridge (`SessionBridge`) and the facade
 * (`PeerEngine`) are the real ones; what is faked here is the socket and the small server
 * vocabulary the relay speaks: `session.hello` and `session.rename`, the opaque binary relay,
 * and the membership events (`peer.joined`, `peer.left`, `peer.renamed`). Nothing is verified,
 * sealed or read below the envelope the relay itself writes, exactly as `PROTOCOL.md` §3 leaves
 * a server that relays frames it cannot read.
 *
 * A side's inbound binary frames can be held instead of delivered, which is what lets a test
 * keep §13.1's window open — the state that seats a joiner arrives, and the test decides when.
 *
 * This is a fixture and not a server: it is not compared against the reference server, and
 * `test/relay-selvaged.test.ts` does not exist in this repository. It exists so the adapter
 * paths can be driven without a Rust build.
 */

import { randomBytes } from 'node:crypto';

import type { WebSocketFactory, WebSocketLike } from '../../src/engine/index.ts';
import { DEFAULT_KEEPALIVE, WIRE_VERSION, code, event } from '../../src/engine/envelope.ts';
import { sessionBase } from '../../src/engine/urls.ts';
import type { SessionBase } from '../../src/engine/urls.ts';

interface Peer {
  peer_id: string;
  display_name: string;
  role: 'host' | 'guest';
}

interface Side {
  socket: FakeSocket;
  peer: Peer;
  seated: boolean;
  held: boolean;
}

interface Room {
  id: string;
  token: string;
  hostId: string;
  sides: Map<string, Side>;
}

export interface FakeRoomOptions {
  /** Display names whose inbound binary frames are queued rather than delivered. */
  holdBinary?: readonly string[];
  keepalive?: typeof DEFAULT_KEEPALIVE;
}

/** The `ws://` base a `RelaySession` is handed; the endpoint path is appended by the engine. */
export const FAKE_BASE = sessionBase('ws://fake.invalid') as SessionBase;

class FakeSocket implements WebSocketLike {
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  private readonly room: FakeRoom;
  readonly sideId: string;

  constructor(room: FakeRoom, sideId: string) {
    this.room = room;
    this.sideId = sideId;
  }

  send(data: string | Uint8Array): void {
    this.room.received(this.sideId, data);
  }

  close(code?: number, reason?: string): void {
    this.room.closed(this.sideId, code ?? 1000, reason ?? '');
  }

  /** The engine's `openSocket` assigns the handlers before this fires. */
  opened(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  deliver(data: string | Uint8Array): void {
    if (this.readyState === 1) {
      this.onmessage?.({ data });
    }
  }

  shut(codeNumber: number, reason: string): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.onclose?.({ code: codeNumber, reason });
  }
}

export class FakeRoom {
  private readonly sides = new Map<string, Side>();
  private readonly heldBinary = new Map<string, Uint8Array[]>();
  private readonly holdNames: Set<string>;
  private readonly keepalive: typeof DEFAULT_KEEPALIVE;
  private room: Room | undefined;

  constructor(options: FakeRoomOptions = {}) {
    this.holdNames = new Set(options.holdBinary ?? []);
    this.keepalive = options.keepalive ?? DEFAULT_KEEPALIVE;
  }

  /** The factory every `RelaySession` in the test dials through. */
  get factory(): WebSocketFactory {
    return (url: string): WebSocketLike => this.dial(url);
  }

  /** The binary frames queued for a held side, oldest first. */
  pendingBinary(displayName: string): Uint8Array[] {
    return [...(this.heldBinary.get(displayName) ?? [])];
  }

  /** Hands a held side the binary frame at `index` and drops it from the queue. */
  deliverBinary(displayName: string, index = 0): void {
    const queue = this.heldBinary.get(displayName);
    const bytes = queue?.[index];
    if (bytes === undefined) {
      throw new Error(`no held binary frame for ${displayName} at ${index}`);
    }
    queue?.splice(index, 1);
    this.sideNamed(displayName)?.socket.deliver(bytes);
  }

  private dial(url: string): WebSocketLike {
    const parsed = new URL(url);
    const roomId = parsed.searchParams.get('room');
    const token = parsed.searchParams.get('token') ?? undefined;
    const id = `p-${randomBytes(4).toString('hex')}`;
    const socket = new FakeSocket(this, id);
    const side: Side = {
      socket,
      peer: roomId === null
        ? { peer_id: id, display_name: '', role: 'host' }
        : { peer_id: id, display_name: '', role: 'guest' },
      seated: false,
      held: false,
    };
    this.sides.set(id, side);
    // The relay awaits `open` before it says `session.hello`, so the open is a turn later.
    queueMicrotask(() => {
      if (roomId !== null && this.room === undefined) {
        this.refuse(side, code.roomUnknown, `no such room: ${roomId}`);
        return;
      }
      if (roomId !== null && token !== this.room?.token) {
        this.refuse(side, code.tokenInvalid, 'invalid room token');
        return;
      }
      socket.opened();
    });
    return socket;
  }

  /** One text frame from a side: the handshake, a rename, or nothing this room speaks. */
  received(sideId: string, data: string | Uint8Array): void {
    const side = this.sides.get(sideId);
    if (side === undefined) {
      return;
    }
    if (typeof data !== 'string') {
      this.relay(side, data);
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message['method'] === 'session.hello') {
      this.hello(side, message);
      return;
    }
    if (message['method'] === 'session.rename') {
      this.rename(side, message);
    }
  }

  private hello(side: Side, message: Record<string, unknown>): void {
    const params = (message['params'] ?? {}) as Record<string, unknown>;
    const name = typeof params['display_name'] === 'string' ? params['display_name'] : '';
    side.peer = { ...side.peer, display_name: name };
    side.held = this.holdNames.has(name);
    const awareness =
      typeof params['awareness_client_id'] === 'number'
        ? Math.trunc(params['awareness_client_id'])
        : undefined;

    if (this.room === undefined) {
      const id = `r-${randomBytes(6).toString('hex')}`;
      const token = randomBytes(16).toString('hex');
      this.room = { id, token, hostId: side.peer.peer_id, sides: new Map() };
      side.seated = true;
      this.room.sides.set(side.peer.peer_id, side);
      this.send(side, event.roomCreated, {
        room_id: id,
        token,
        self: this.selfOf(side, awareness),
        peers: [],
        capabilities: ['y-protocols/1', 'awareness'],
        keepalive: this.keepalive,
      });
      return;
    }

    const room = this.room;
    side.seated = true;
    this.room.sides.set(side.peer.peer_id, side);
    this.send(side, event.roomJoined, {
      room_id: room.id,
      self: this.selfOf(side, awareness),
      peers: [...room.sides.values()]
        .filter((other) => other !== side)
        .map((other) => other.peer),
      capabilities: ['y-protocols/1', 'awareness'],
      keepalive: this.keepalive,
    });
    for (const other of room.sides.values()) {
      if (other !== side) {
        this.send(other, event.peerJoined, { peer: side.peer });
      }
    }
  }

  private rename(side: Side, message: Record<string, unknown>): void {
    const params = (message['params'] ?? {}) as Record<string, unknown>;
    const name = typeof params['display_name'] === 'string' ? params['display_name'] : '';
    const id = typeof message['id'] === 'number' ? Math.trunc(message['id']) : 1;
    if (this.room === undefined) {
      this.sendRaw(side, { v: WIRE_VERSION, id, error: { code: code.roomGone, message: 'the room is gone' } });
      return;
    }
    side.peer = { ...side.peer, display_name: name };
    this.sendRaw(side, { v: WIRE_VERSION, id, result: {} });
    for (const other of this.room.sides.values()) {
      if (other !== side) {
        this.send(other, event.peerRenamed, { peer_id: side.peer.peer_id, display_name: name });
      }
    }
  }

  private relay(from: Side, bytes: Uint8Array): void {
    for (const other of this.room?.sides.values() ?? []) {
      if (other === from) {
        continue;
      }
      if (other.held) {
        const queue = this.heldBinary.get(other.peer.display_name) ?? [];
        queue.push(bytes);
        this.heldBinary.set(other.peer.display_name, queue);
      } else {
        other.socket.deliver(bytes);
      }
    }
  }

  private closed(sideId: string, codeNumber: number, reason: string): void {
    const side = this.sides.get(sideId);
    if (side === undefined) {
      return;
    }
    this.sides.delete(sideId);
    this.room?.sides.delete(side.peer.peer_id);
    if (side.seated) {
      for (const other of this.room?.sides.values() ?? []) {
        this.send(other, event.peerLeft, { peer_id: side.peer.peer_id });
      }
    }
    side.socket.shut(codeNumber, reason);
  }

  private refuse(side: Side, codeName: string, message: string): void {
    this.send(side, event.sessionError, { code: codeName, message });
    side.socket.shut(4000, message);
  }

  private selfOf(side: Side, awareness: number | undefined): Peer & { awareness_client_id?: number } {
    return awareness === undefined ? side.peer : { ...side.peer, awareness_client_id: awareness };
  }

  private sideNamed(displayName: string): Side | undefined {
    for (const side of this.sides.values()) {
      if (side.peer.display_name === displayName) {
        return side;
      }
    }
    return undefined;
  }

  private send(side: Side, name: string, params: unknown): void {
    this.sendRaw(side, { v: WIRE_VERSION, event: name, params });
  }

  private sendRaw(side: Side, body: Record<string, unknown>): void {
    side.socket.deliver(JSON.stringify(body));
  }
}
