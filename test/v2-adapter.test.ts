/**
 * The page's `selvage/2` wiring: which version a link asks for, which version a host mints, and
 * the one place a host's listing is read from.
 *
 * `§5.1` is the whole of the first answer: the room key and the host key travel on the link's
 * fragment, so a link that names both is a version-2 room and a link with none — every link the
 * published client has ever handed on — is not. The second is the server's to seat (`§2`): a page
 * that can speak `selvage/2` mints it wherever the server offers it, refuses locally where a
 * reachable `/meta` does not — never a fall back to the readable wire — and takes `?wire=…` on its
 * own address as the pin that says otherwise (see `host.ts` for the copy a refusal is shown in).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hostDecision, hostPin, listingSource, pageEngine, wireVersionOf } from '../src/browser/relay.ts';
import { PeerEngine } from '../src/bridge/index.ts';
import { buildShareLink, parsePageLink } from '../src/browser/share.ts';
import { fragmentOf, resolveJoin } from '../src/browser/join.ts';
import { parseSessionUrl, sessionUrl } from '../src/engine/urls.ts';
import type { EngineEvent, Meta, SessionInfo } from '../src/engine/index.ts';

/** `§5.1`'s fragment, the shape `encodeKey` writes: two 43-character base64url keys. */
const KEYS =
  '#k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&h=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

describe('the version a link asks for', () => {
  it('a fragment naming both keys is a selvage/2 invite', () => {
    assert.equal(wireVersionOf(`ws://edit.example/session?room=r-1&token=tok${KEYS}`), 'selvage/2');
    assert.equal(wireVersionOf(`https://edit.example/?room=r-1&token=tok${KEYS}`), 'selvage/2');
  });

  it('a fragment that names neither key is not', () => {
    // `#x` is a fragment a page's own address can already carry, and it names no key: it must not
    // send a join to an engine that would then refuse the invite it was handed.
    assert.equal(wireVersionOf('ws://edit.example/session?room=r-1&token=tok#x'), 'selvage/1');
  });

  it('a fragment that names one key is a selvage/2 link, refused by the missing key, never joined in the clear', async () => {
    // §5.1 and `specification/vectors/peer/157`: a half-copied fragment goes to the version-2
    // engine, whose reading of the link refuses it locally and names what is missing — and not to
    // the version-1 engine, which would seat the guest in a room the server reads.
    // Well-formed 32-byte spellings, so what is refused is the missing key and nothing else.
    const key = 'A'.repeat(43);
    const onlyK = `ws://edit.example/session?room=r-1&token=tok#k=${key}`;
    const onlyH = `ws://edit.example/session?room=r-1&token=tok#h=${key}`;
    assert.equal(wireVersionOf(onlyK), 'selvage/2');
    assert.equal(wireVersionOf(onlyH), 'selvage/2');
    for (const [invite, missing] of [
      [onlyK, /`h`/],
      [onlyH, /`k`/],
    ] as const) {
      let dialled = false;
      await assert.rejects(
        () =>
          PeerEngine.join({
            invite,
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

  it('a link with no fragment at all is the version every published client speaks', () => {
    assert.equal(wireVersionOf('ws://edit.example/session?room=r-1&token=tok'), 'selvage/1');
  });

  it('another parameter beside the two keys does not change the version', () => {
    assert.equal(wireVersionOf(`ws://edit.example/session?room=r-1&token=tok${KEYS}&x=1`), 'selvage/2');
  });
});

describe('the version this page is pinned to', () => {
  it('reads both spellings of each version, wherever the parameter sits', () => {
    assert.equal(hostPin('?wire=2'), 'selvage/2');
    assert.equal(hostPin('wire=2'), 'selvage/2');
    assert.equal(hostPin('?wire=selvage/2'), 'selvage/2');
    assert.equal(hostPin('?debug=1&wire=2'), 'selvage/2');
    assert.equal(hostPin('?wire=1'), 'selvage/1');
    assert.equal(hostPin('?wire=selvage/1'), 'selvage/1');
  });

  it('pins nothing where the address says nothing, or says what no version is', () => {
    // Unset is the auto reading, which is what a published page is: the server's own word decides,
    // so the same address hosts the encrypted room on a server that seats it and refuses on one
    // that does not, rather than quietly minting a readable room on the second.
    assert.equal(hostPin(''), undefined);
    assert.equal(hostPin('?'), undefined);
    assert.equal(hostPin('?wire=auto'), undefined);
    assert.equal(hostPin('?wire=3'), undefined);
    assert.equal(hostPin('?other=2'), undefined);
  });
});

describe('the version a host mints', () => {
  it('is the encrypted wire wherever the server seats it, unpinned', () => {
    assert.deepEqual(hostDecision({ wire_versions: ['selvage/1', 'selvage/2'] }, ''), {
      outcome: 'mint',
      version: 'selvage/2',
    });
    assert.deepEqual(hostDecision({ wire_versions: ['selvage/2'] }, ''), {
      outcome: 'mint',
      version: 'selvage/2',
    });
    // §10's compatibility rule: a server that accepts `selvage/2` accepts any `selvage/2.x`.
    assert.deepEqual(hostDecision({ wire_versions: ['selvage/2.1'] }, ''), {
      outcome: 'mint',
      version: 'selvage/2',
    });
  });

  it('is refused where /meta answered without it, and never the readable wire instead', () => {
    assert.deepEqual(hostDecision({ wire_versions: ['selvage/1'] }, ''), {
      outcome: 'refuse',
      reason: 'not-seated',
      offered: ['selvage/1'],
    });
  });

  it('is the pin, and a pin the server does not seat is refused rather than fallen back from', () => {
    assert.deepEqual(hostDecision({ wire_versions: ['selvage/1'] }, '?wire=1'), {
      outcome: 'mint',
      version: 'selvage/1',
    });
    assert.deepEqual(hostDecision({ wire_versions: ['selvage/1', 'selvage/2'] }, '?wire=1'), {
      outcome: 'mint',
      version: 'selvage/1',
    });
    assert.deepEqual(hostDecision({ wire_versions: ['selvage/2'] }, '?wire=1'), {
      outcome: 'refuse',
      reason: 'pin-not-seated',
      offered: ['selvage/2'],
      pin: 'selvage/1',
    });
  });

  it('is the encrypted wire where /meta could not be read, because that is no answer', () => {
    // `undefined` is unreachable, not JSON, or no fetch at all: the endpoint is advisory, so the
    // attempt is made and the handshake is what reports the truth.
    assert.deepEqual(hostDecision(undefined, ''), { outcome: 'mint', version: 'selvage/2' });
    // And a body that says nothing about versions is the same reading `metaAccepts` takes of it.
    assert.deepEqual(hostDecision({}, ''), { outcome: 'mint', version: 'selvage/2' });
    // A pin is a person's own choice and decides where the server said nothing at all.
    assert.deepEqual(hostDecision(undefined, '?wire=1'), { outcome: 'mint', version: 'selvage/1' });
  });
});

describe("a version-2 host's listing", () => {
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

describe('a version-2 link', () => {
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

  it('a page link with no fragment joins the way it always did', () => {
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

describe('the page picks the version', () => {
  it('routes a link that names two keys to the version-2 join, and any other to the engine it had', () => {
    assert.match(
      main,
      /wireVersionOf\(invite\) === 'selvage\/2'[\s\S]{0,20}\? await joinRoom2\(invite, displayName\)[\s\S]{0,20}: await SelvageEngine\.join\(address, displayName, CLIENT_OPTIONS\)/,
      'a join no longer chooses its engine by the link it was handed',
    );
  });

  it('hands a version-1 join the address alone, because a fragment glues into its token', () => {
    // The fragment belongs to `§5.1` and to the version-2 engine. The version-1 engine reads its
    // query with the splitter in `urls.ts`, which takes everything after `?` — so a fragment on
    // that URL is part of the token, and a link that carried one was a working join before this
    // change. `main.ts` passes `address` on that path, and the assertion below is why.
    const address = sessionUrl(sessionUrlBase(), 'r-1', 'tok');
    assert.equal(parseSessionUrl(`${address}#x`)?.join.token, 'tok#x', 'the fragment does reach the token');
    assert.equal(parseSessionUrl(address)?.join.token, 'tok');
    assert.match(
      main,
      /: await SelvageEngine\.join\(address, displayName, CLIENT_OPTIONS\)/,
      'a version-1 join is no longer handed the fragment-free address',
    );
  });

  it('walks the folder before the version-2 mint, and not before the version-1 one', () => {
    // `§7.1` seals the room state from the listing, so a host that minted first would put an
    // empty tree in front of its first guest.
    assert.match(
      main,
      /hostDecision\(await readMeta\(base\), window\.location\.search\)[\s\S]*?listingSource\(await folder\.list\(\)\)[\s\S]*?\? await hostRoom2\(base, displayName, listing\)/,
      'a version-2 mint no longer follows the folder walk',
    );
  });

  it('asks the server for the version before it mints, and refuses without opening a socket', () => {
    // §2: a hosting page takes the version the server seats, and a reachable `/meta` that seats
    // no `selvage/2` is a local refusal — never a fall back — so the throw stands before anything
    // that could dial, and the two mints are the only ways out of the decision.
    assert.match(
      main,
      /const decision = hostDecision\(await readMeta\(base\), window\.location\.search\);\n  if \(decision\.outcome === 'refuse'\) \{\n    throw new Error\(hostRefusalSentence\(decision\)\);\n  \}[\s\S]*?await hostRoom2\(base, displayName, listing\)[\s\S]*?: await SelvageEngine\.host\(base, displayName, CLIENT_OPTIONS\)/,
      'a hosting decision no longer stands before the mint, or a refusal reaches an engine',
    );
  });

  it('reads /meta best effort, so an endpoint that did not answer is not an answer', () => {
    assert.match(
      main,
      /async function readMeta\(base: string\): Promise<Meta \| undefined> \{[\s\S]*?try \{[\s\S]*?return await fetchMeta\(base\);\n  \} catch \{\n    return undefined;\n  \}/,
      'a /meta that could not be read is threaded into the decision as something other than no answer',
    );
  });

  it('asks the folder picker before that read, because the picker needs the click', () => {
    // `showDirectoryPicker` is answered only under the click's own transient activation, which a
    // `/meta` round trip can spend: the picker comes first in the one place both mints meet.
    const attempt = /async function attemptHost\(\)[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
    assert.ok(attempt.includes('await pickFolder(folderPicker)'), 'the picker is not asked at all');
    assert.ok(!attempt.includes('readMeta'), 'a /meta read stands before the picker');
  });

  it('leaves a join to the version its invite names, whatever the page is pinned to', () => {
    const join = /async function join\(held: HeldJoin\)[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
    assert.ok(join !== '', 'the page has no join to read');
    assert.ok(!join.includes('hostPin'), 'a join reads the host pin');
    assert.ok(!join.includes('hostDecision'), 'a join reads the hosting decision');
    assert.ok(!join.includes('hostRefusalSentence'), 'a join reads the hosting refusal');
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
} {
  const listeners = new Set<(event: EngineEvent) => void>();
  let peer = { peer_id: 'p-first', display_name: 'sam', role: 'guest' };
  let documents = ['notes.md'];
  let granted = ['shared/'];
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
  };
}

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
});

/** A session base in the one spelling every consumer is written in. */
function sessionUrlBase(): Parameters<typeof sessionUrl>[0] {
  return 'wss://edit.example';
}

/** The search parameters a page's own address carries, which is what the address bar is read as. */
function searchParamsOf(link: string): URLSearchParams {
  return new URL(link).searchParams;
}
