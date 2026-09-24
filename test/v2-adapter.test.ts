/**
 * The page's `selvage/2` wiring: the one place a host's listing is read from, and the wrapper the
 * binding and the session bar drive.
 *
 * The wire has one version, so nothing here chooses one: a join hands the engine the link it was
 * given, and `§5.1`'s fragment — the room key and the host key — is what makes it a room at all.
 * A link whose fragment is missing a key is refused locally, by the name of the key, before a
 * socket: the engine's own reading (`peer.ts`), which is what this page now hands every link to.
 * That refusal is pinned here because nothing in the page chooses between engines any more.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { listingSource, pageEngine } from '../src/browser/relay.ts';
import { PeerEngine } from '../src/bridge/index.ts';
import { buildShareLink, parsePageLink } from '../src/browser/share.ts';
import { fragmentOf, resolveJoin } from '../src/browser/join.ts';
import { sessionUrl } from '../src/engine/urls.ts';
import type { EngineEvent, SessionInfo } from '../src/engine/index.ts';

/** `§5.1`'s fragment, the shape `encodeKey` writes: two 43-character base64url keys. */
const KEYS =
  '#k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&h=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

describe("a host's listing", () => {
  it('is one place to read and one to replace', () => {
    const listing = listingSource(['notes.txt']);
    assert.deepEqual(listing.current(), ['notes.txt']);
    listing.replace(['notes.txt', 'src/main.ts']);
    assert.deepEqual(listing.current(), ['notes.txt', 'src/main.ts']);
    // The caller's array is not the source's: a state is sealed from this, and a walk that
    // mutates what it was read into would change what the room is told.
    const paths = ['a.txt'];
    const fromWalk = listingSource(paths);
    paths.push('b.txt');
    assert.deepEqual(fromWalk.current(), ['a.txt']);
  });

  it('starts empty when the folder named nothing', () => {
    assert.deepEqual(listingSource().current(), []);
  });
});

describe('a link', () => {
  it('carries the fragment on the page link a host hands on', () => {
    const link = buildShareLink('wss://edit.example', 'r-1', 'tok', KEYS);
    assert.equal(link, `https://edit.example/?room=r-1&token=tok${KEYS}`);
    // The two forms of the link are the same room, the same token and the same two keys: this is
    // the page link, and the wire invite is what the engine minted.
    assert.deepEqual(parsePageLink(link), {
      room: 'r-1',
      token: 'tok',
      origin: 'https://edit.example',
      fragment: KEYS,
    });
    assert.deepEqual(resolveJoin(searchParamsOf(link), '', link), {
      base: 'wss://edit.example',
      room: 'r-1',
      token: 'tok',
      fragment: KEYS,
    });
  });

  it('a page link with no fragment reads as a link with no room key', () => {
    // The page hands a host's link on with the fragment and nothing else is generated here. A
    // link without one is a join the engine refuses where it is read (§5.1), which is a rule of
    // `peer.ts` rather than this page's.
    const link = buildShareLink('wss://edit.example', 'r-1', 'tok');
    assert.equal(link, 'https://edit.example/?room=r-1&token=tok');
    assert.equal(fragmentOf(link), '');
    assert.deepEqual(resolveJoin(new URLSearchParams(), link, 'https://edit.example/'), {
      base: 'wss://edit.example',
      room: 'r-1',
      token: 'tok',
      fragment: '',
    });
  });

  it('a fragment is never query data', () => {
    assert.equal(fragmentOf('https://edit.example/?room=r-1&token=tok#k=1'), '#k=1');
    assert.equal(fragmentOf('https://edit.example/?room=r-1&token=tok'), '');
    assert.equal(fragmentOf('no hash here'), '');
  });
});

describe('the page the bundle built', () => {
  it('joins with the link it was handed, and hosts only after walking the folder', () => {
    // One wire, so no path chooses an engine: the join hands the engine its link, and the host
    // walks the folder first because `§7.1` seals the room state from the listing — a host that
    // minted first would put an empty tree in front of its first guest.
    const join = /async function join\(held: HeldJoin\)[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
    assert.ok(join !== '', 'the page has no join to read');
    assert.match(
      join,
      /await joinRoom\(invite, displayName\)/,
      'the join does not hand the engine its link',
    );
    assert.ok(
      !/SelvageEngine|CLIENT_OPTIONS|wireVersionOf|hostDecision/.test(main),
      'the page still decides a wire version somewhere',
    );

    const hosting = /async function host\(folder: FolderWorkingCopy[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
    assert.ok(hosting !== '', 'the page has no host to read');
    assert.match(
      hosting,
      /listingSource\(await folder\.list\(\)\)[\s\S]*?await hostRoom\(base, displayName, listing\)/,
      'the mint no longer follows the folder walk',
    );
  });

  it('asks the folder picker before anything that could await', () => {
    // `showDirectoryPicker` is answered only under the click's own transient activation, which a
    // round trip can spend: the picker comes first in the one place the host path begins.
    const attempt = /async function attemptHost\(\)[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
    assert.ok(attempt.includes('await pickFolder(folderPicker)'), 'the picker is not asked at all');
    assert.ok(!attempt.includes('readMeta'), 'a /meta read stands before the picker');
  });

  it('holds the engine a session was seated on, instead of only passing it around', () => {
    // The page keeps one for the life of a session and drops it with the teardown: the own row's
    // colour and role, a rename, the fallback read of a path this window has no model for, the
    // socket the leave closes and the one `beforeunload` closes are all reads of it, and every one
    // of them is a no-op when nothing assigns it. `prove:v2` is where that showed: with the line
    // gone the browser's socket stayed open and the room kept the seat of a guest that left.
    const seat = /async function seatSession\(seat: Seat\)[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
    assert.ok(seat !== '', 'the page has no seatSession to read');
    assert.match(seat, /^\s*engine = /m, 'the page holds no engine: leaving it closes no socket');
  });
});

/**
 * The `RoomEngine` the page drives, over a stub `PeerEngine` whose session a test can move the way
 * a re-seat does. Only what {@link pageEngine} asks of its engine is here; anything else it
 * reached for would be `undefined` and fail below rather than being quietly answered.
 */
function stubEngine(): {
  engine: Parameters<typeof pageEngine>[0];
  reseat(): void;
  emit(event: EngineEvent): void;
  renamed(): string | undefined;
} {
  const listeners = new Set<(event: EngineEvent) => void>();
  let peer = { peer_id: 'p-first', display_name: 'sam', role: 'guest' };
  let documents = ['notes.md'];
  let granted = ['shared/'];
  let renamed: string | undefined;
  return {
    engine: {
      session: () => ({
        roomId: 'r-1',
        role: 'guest',
        peer,
        peers: [peer],
        documents,
        capabilities: [],
        keepalive: { ping_interval_ms: 30_000, awareness_renew_ms: 15_000, awareness_expire_ms: 30_000 },
        baseUrl: sessionUrlBase(),
      }) as SessionInfo,
      text: () => '',
      has: () => true,
      open: async () => {},
      close: async () => {},
      insert: () => {},
      delete: () => {},
      setSelection: () => {},
      setAwareness: () => {},
      presence: () => [],
      resolveSelection: () => undefined,
      on: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      grantedPaths: () => granted,
      grant: async (paths) => void (granted = [...paths]),
      rename: async (name) => void (renamed = name),
      disconnect: () => {},
      inviteUrl: () => undefined,
    } as unknown as Parameters<typeof pageEngine>[0],
    reseat(): void {
      // A reconnect is a new peer under the same room (`§9.1`): the room's state is republished
      // to it, which is the set and the listing arriving again.
      peer = { peer_id: 'p-seated-again', display_name: 'sam', role: 'guest' };
      documents = ['notes.md', 'later.txt'];
      granted = ['shared/', 'shared/two.txt'];
    },
    emit(event: EngineEvent): void {
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    renamed: () => renamed,
  };
}

describe('the fragment a link must carry', () => {
  /** A well-formed 32-byte key spelling, so what is refused is the missing key and nothing else. */
  const key = 'A'.repeat(43);

  it('a fragment missing a key is refused locally, by the name of the missing key', async () => {
    // `§5.1` and `specification/vectors/peer/157`: a half-copied link is refused here rather than
    // joined, and the sentence names what is missing. Nothing dials.
    for (const [fragment, missing] of [
      [`k=${key}`, /`h`/],
      [`h=${key}`, /`k`/],
    ] as const) {
      let dialled = false;
      await assert.rejects(
        () =>
          PeerEngine.join({
            invite: `ws://edit.example/session?room=r-1&token=tok#${fragment}`,
            displayName: 'Bob',
            webSocketFactory: () => {
              dialled = true;
              throw new Error('the engine dialled a link it should have refused');
            },
          }),
        missing,
      );
      assert.equal(dialled, false, 'the partial fragment was refused only after a socket');
    }
  });

  it('a link with no fragment at all is refused locally, and a whole one is not', async () => {
    await assert.rejects(
      () =>
        PeerEngine.join({
          invite: 'ws://edit.example/session?room=r-1&token=tok',
          displayName: 'Bob',
        }),
      /no fragment/,
    );
    // The whole link is the page's own shape: asserted here so the refusal above cannot be a
    // refusal of every link.
    const whole = `https://edit.example/?room=r-1&token=tok#k=${key}&h=${key}`;
    assert.ok(
      resolveJoin(searchParamsOf(whole), '', whole).fragment.startsWith('#k='),
      'a whole fragment is not the shape the page hands the join',
    );
  });
});

describe('the wrapper the page drives', () => {
  it('survives a re-seat, because every answer is read from the session as it stands', async () => {
    const stub = stubEngine();
    const room = pageEngine(stub.engine);
    const heard: string[] = [];
    room.on((event) => void heard.push(event.type));

    await room.open('notes.md');
    assert.deepEqual(room.openDocuments(), ['notes.md'], 'the open document was not held');
    assert.equal(room.session().peer.peer_id, 'p-first');

    // What `§9.1` does below the seam: the same engine object, a new seat, the room's state sent
    // again. Nothing above this line is rebuilt, so nothing the page holds may be a snapshot.
    stub.reseat();

    assert.equal(room.session().peer.peer_id, 'p-seated-again', 'the wrapper answers a dead seat');
    assert.deepEqual(room.peers().map((peer) => peer.peer_id), ['p-seated-again']);
    assert.deepEqual(room.documents(), ['notes.md', 'later.txt'], 'the re-seat lost the documents');
    assert.deepEqual(room.grantedPaths(), ['shared/', 'shared/two.txt'], 'the listing did not come back');
    assert.deepEqual(room.openDocuments(), ['notes.md'], 'the paths this window holds went with the seat');

    // The seat reports the bridge forces on a re-seat reach this wrapper's listener: they are
    // what the page reads as the all-clear that ends its reconnecting line.
    stub.emit({ type: 'documentsChanged', documents: room.documents() });
    stub.emit({ type: 'peersChanged', peers: room.peers() });
    assert.deepEqual(heard, ['documentsChanged', 'peersChanged'], `the re-seat said ${heard.join(', ')}`);

    await room.close('notes.md');
    assert.deepEqual(room.openDocuments(), [], 'a closed document stayed held');
  });

  it('carries a rename through to the engine the page handed it', async () => {
    // The page's own row is not a seat the room lists (`§13.4`), so the page tells the room the
    // new name itself and keeps it: what this wrapper owes is the one call it sits in front of.
    const stub = stubEngine();
    const room = pageEngine(stub.engine);
    await room.rename('ada');
    assert.equal(stub.renamed(), 'ada', 'the rename never reached the engine');
  });
});

/** A session base in the one spelling every consumer is written in. */
function sessionUrlBase(): Parameters<typeof sessionUrl>[0] {
  return 'wss://edit.example';
}

/** The search parameters a page's own address carries, which is what the address bar is read as. */
function searchParamsOf(link: string): URLSearchParams {
  return new URL(link).searchParams;
}
