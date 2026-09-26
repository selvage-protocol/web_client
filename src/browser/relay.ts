/**
 * The page's `selvage/2` room: the wiring the vendored engine's relay is, with this client's own
 * socket and crypto.
 *
 * The socket wiring is `src/engine/relay.ts` and the adapter's vocabulary is
 * `src/bridge/peer-engine.ts`; what is left for this file is what a page decides differently. The
 * crypto is the engine's WebCrypto default — a page needs no seam of its own, because
 * `globalThis.crypto` *is* WebCrypto here — and the socket is the browser's own WebSocket
 * (`nativeWebSocketFactory`), which is the one the `ws` stub exists to keep out of a Node path.
 *
 * `RoomEngine` is what the page's binding and its session bar ask of the engine, and
 * {@link pageEngine} is the wrapper that answers it.
 */

import { PeerEngine } from '../bridge/index.ts';
import type { Engine } from '../bridge/index.ts';
import type {
  EngineEventListener,
  OffsetSelection,
  PeerInfo,
  Role,
  Selection,
  SessionInfo,
} from '../engine/index.ts';

import { RelaySession } from '../engine/relay.ts';

import { CLIENT_ID } from './client-id.ts';
import { nativeWebSocketFactory } from './transport.ts';

/**
 * What the page drives: the bridge's own slice, plus the six facts this client reads of a room
 * that a bridge has no use for — its own session, the peers, the documents this window holds
 * open, the room's listing, the connection's invite, and the name it is seated under.
 */
export interface RoomEngine extends Engine {
  session(): SessionInfo;
  peers(): PeerInfo[];
  documents(): string[];
  openDocuments(): string[];
  grantedPaths(): string[];
  grant(paths: readonly string[]): Promise<void>;
  /** Changes the name the room sees (`PROTOCOL.md` §5), the page's own seat included. */
  rename(displayName: string): Promise<void>;
  /** Ends the room for everyone, which only its host may do (`§7.1`). */
  closeRoom(): Promise<boolean>;
  disconnect(): Promise<void> | void;
  inviteUrl(): string | undefined;
}

/**
 * The listing a host shares (`§7.1`), as the page's own folder walk reads it.
 *
 * One place to read and one to replace, because a state is sealed from it: a host that said the
 * tree changed and had the previous one published would be telling the room about a folder it no
 * longer has.
 */
export interface ListingSource {
  current(): readonly string[];
  replace(paths: readonly string[]): void;
}

/** A listing source over the page's folder work, walked once by the caller before the mint. */
export function listingSource(paths: readonly string[] = []): ListingSource {
  let listing = [...paths];
  return {
    current: () => listing,
    replace: (next) => {
      listing = [...next];
    },
  };
}

/**
 * Opens a room as its host, with the listing the folder had when this was called.
 *
 * The relay is seated here rather than by `PeerEngine.host` so the page keeps a hand on it: the
 * closing that ends the room for its guests (`§7.1`) is the relay's, and the bridge has no word
 * for it.
 */
export async function hostRoom(
  base: string,
  displayName: string,
  listing: ListingSource,
): Promise<RoomEngine> {
  const relay = await RelaySession.host({
    baseUrl: base,
    displayName,
    listing: () => listing.current(),
    webSocketFactory: nativeWebSocketFactory,
    client: CLIENT_ID,
  });
  return pageEngine(new PeerEngine({ relay, displayName }), { relay, listing });
}

/**
 * Joins the room an invite names, from either form of the link: the connection URL a `ws://`
 * invite carries, or the page link whose own origin is the server to dial.
 */
export async function joinRoom(invite: string, displayName: string): Promise<RoomEngine> {
  return pageEngine(
    await PeerEngine.join({
      invite,
      displayName,
      webSocketFactory: nativeWebSocketFactory,
      client: CLIENT_ID,
    }),
  );
}

/**
 * The engine in the shape the page drives.
 *
 * Two of the six are the page's own bookkeeping rather than the session's. `openDocuments` is
 * what *this* window has asked to hold — a room's documents are the paths somebody
 * holds, so the room's set is not this connection's — and it is kept here because this adapter is
 * the only caller of `open` and `close`. `peers` is the room state's roster, which the session
 * already carries. `rename` is the bridge's own method passed straight through, and the page
 * keeps the name it is seated under itself: §5 announces the change to the room, the connection
 * that asked included, but only after the request has returned, so the row wears the new name
 * before the engine's own copy of it does.
 *
 * Nothing here is a snapshot of the session. `§9.1`'s reconnect re-hellos and re-seats under a new
 * peer id *inside* the relay, over the same engine object, so every answer below is read from the
 * engine as it stands and the held set — which belongs to this window and not to the connection —
 * outlives the re-seat.
 */
export function pageEngine(
  engine: PeerEngine,
  hosting?: { relay: RelaySession; listing: ListingSource },
): RoomEngine {
  const held = new Set<string>();
  return {
    session: () => engine.session(),
    text: (path: string) => engine.text(path),
    has: (path: string) => engine.has(path),
    open: async (path: string) => {
      held.add(path);
      await engine.open(path);
    },
    close: async (path: string) => {
      held.delete(path);
      await engine.close(path);
    },
    insert: (path: string, index: number, text: string) => {
      engine.insert(path, index, text);
    },
    delete: (path: string, index: number, length: number) => {
      engine.delete(path, index, length);
    },
    setSelection: (path: string, selection: OffsetSelection) => {
      engine.setSelection(path, selection);
    },
    setAwareness: (state: Parameters<Engine['setAwareness']>[0]) => {
      engine.setAwareness(state);
    },
    presence: () => engine.presence(),
    resolveSelection: (path: string, selection: Selection) =>
      engine.resolveSelection(path, selection),
    on: (listener: EngineEventListener) => engine.on(listener),
    peers: () => engine.session().peers,
    documents: () => engine.session().documents,
    openDocuments: () => [...held].sort(),
    grantedPaths: () => engine.grantedPaths(),
    grant: (paths: readonly string[]) => {
      hosting?.listing.replace(paths);
      return engine.grant(paths);
    },
    rename: (displayName: string) => engine.rename(displayName),
    closeRoom: async () => (await hosting?.relay.closeRoom()) ?? false,
    disconnect: () => engine.disconnect(),
    inviteUrl: () => engine.inviteUrl(),
  };
}

export type { Role };
