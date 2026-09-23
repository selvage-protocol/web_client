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
 * `RoomEngine` is what the page's binding and its session bar ask of whichever version is seated.
 * Both versions answer it; the version-1 class satisfies it as it stands, and
 * {@link pageEngine} wraps the version-2 one so that it does too.
 *
 * The two versions are also chosen here, from the two things that choose them: `wireVersionOf` is
 * `§5.1`'s rule for a link, and {@link hostDecision} is `§2`'s for a host.
 */

import { PeerEngine } from '../bridge/index.ts';
import type { Engine } from '../bridge/index.ts';
import { hostVersion } from '../engine/index.ts';
import type {
  EngineEventListener,
  HostDecision,
  Meta,
  OffsetSelection,
  PeerInfo,
  Role,
  Selection,
  SessionInfo,
  WireVersion,
} from '../engine/index.ts';

import { nativeWebSocketFactory } from './transport.ts';

/**
 * What the page drives: the bridge's own slice, plus the five facts this client reads of a room
 * that a bridge has no use for — its own session, the peers, the documents this window holds
 * open, the room's listing, and the connection's invite.
 */
export interface RoomEngine extends Engine {
  session(): SessionInfo;
  peers(): PeerInfo[];
  documents(): string[];
  openDocuments(): string[];
  grantedPaths(): string[];
  grant(paths: readonly string[]): Promise<void>;
  disconnect(): Promise<void> | void;
  inviteUrl(): string | undefined;
}

/** The version this module speaks. `selvage/1` is the engine's, and stays where it is. */
export const WIRE_VERSION_2 = 'selvage/2';

/**
 * The version a pasted invite asks for, from the one thing that says it: `§5.1`'s fragment, which
 * carries the room key and the host key. A `selvage/1` invite has none, and a server seats a
 * version-2 room only for a connection that can read one.
 */
export function wireVersionOf(invite: string): 'selvage/1' | 'selvage/2' {
  const hash = invite.indexOf('#');
  if (hash === -1) {
    return 'selvage/1';
  }
  const names = new Set(
    invite
      .slice(hash + 1)
      .split('&')
      .map((part) => part.split('=')[0] ?? ''),
  );
  return names.has('k') && names.has('h') ? 'selvage/2' : 'selvage/1';
}

/**
 * The version this page's own address pins it to (`?wire=…`), or `undefined` when it pins nothing.
 *
 * A pin is a deliberate choice of version, and it is the host's: `?wire=1` asks for a room the
 * server can read and `?wire=2` for the encrypted one, and the two spellings a person types — the
 * number and the version — are both read. Nothing else pins: unset, `?wire=auto` and anything no
 * version grammar accepts leave the server's `/meta` to decide, which is what a published page
 * does. A join is unaffected — it speaks the version its invite names.
 */
export function hostPin(search: string): WireVersion | undefined {
  const wire = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('wire');
  if (wire === '2' || wire === WIRE_VERSION_2) {
    return WIRE_VERSION_2;
  }
  if (wire === '1' || wire === 'selvage/1') {
    return 'selvage/1';
  }
  return undefined;
}

/**
 * The version this page hosts a room at, from the server's own answer and this page's pin.
 *
 * `meta` is what `fetchMeta` answered, and `undefined` is a `/meta` that could not be read at all —
 * unreachable, not JSON, no fetch — which is *not* an answer about versions: the page attempts
 * `selvage/2`, and a server that seats only `selvage/1` refuses that hello loudly. The rule itself
 * is the engine's (`hostVersion`), so every client decides it the same way; what is this client's
 * is the pin, `?wire=…` on the page's own address.
 */
export function hostDecision(meta: Meta | undefined, search: string): HostDecision {
  return hostVersion(meta, hostPin(search));
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
 * Opens a room as its host at `selvage/2`, with the listing the folder had when this was called.
 */
export async function hostRoom2(
  base: string,
  displayName: string,
  listing: ListingSource,
): Promise<RoomEngine> {
  return pageEngine(
    await PeerEngine.host({
      baseUrl: base,
      displayName,
      listing,
      webSocketFactory: nativeWebSocketFactory,
      client: 'selvage-web',
    }),
  );
}

/**
 * Joins the room an invite names, from either form of the link: the connection URL a `ws://`
 * invite carries, or the page link whose own origin is the server to dial.
 */
export async function joinRoom2(invite: string, displayName: string): Promise<RoomEngine> {
  return pageEngine(
    await PeerEngine.join({
      invite,
      displayName,
      webSocketFactory: nativeWebSocketFactory,
      client: 'selvage-web',
    }),
  );
}

/**
 * The version-2 engine in the shape the page drives.
 *
 * Two of the five are the page's own bookkeeping rather than the session's. `openDocuments` is
 * what *this* window has asked to hold — a version-2 room's documents are the paths somebody
 * holds, so the room's set is not this connection's — and it is kept here because this adapter is
 * the only caller of `open` and `close`. `peers` is the room state's roster, which the session
 * already carries.
 */
function pageEngine(engine: PeerEngine): RoomEngine {
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
    grant: (paths: readonly string[]) => engine.grant(paths),
    disconnect: () => engine.disconnect(),
    inviteUrl: () => engine.inviteUrl(),
  };
}

export type { Role };
