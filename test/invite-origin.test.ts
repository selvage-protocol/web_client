/**
 * The link is the server: the page derives the server from the invite's own
 * origin — its own address for a link in the address bar, the link's address
 * for one pasted in — so a page served from one origin joining a room on
 * another talks to the room's server and never to its own. What the engine
 * derives from the base, and that the page's own address reads back as that
 * base, are pinned here.
 *
 * There is no built-in server: a page that names none — a `file://` page, which
 * no server serves — is refused rather than pointed at a default, because a
 * default is an address the room may not be on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { metaUrl, sessionUrl } from '../src/engine/index.ts';
import { pageOriginOf, schemeMatchBase, serverBaseOf } from '../src/browser/servers.ts';
import { resolveJoin } from '../src/browser/join.ts';
import { buildShareLink, pageQueryParams, parsePageLink } from '../src/browser/share.ts';

/** The page the guest is standing on, in the case where it is not the room's. */
const PAGE = 'https://page.example/';

describe('the server a link names', () => {
  it('is the page the room\'s own server serves, one origin for both halves', () => {
    const link = buildShareLink('wss://selvage.dontblameme.dev', 'r-1', 'tok');
    assert.equal(link, 'https://selvage.dontblameme.dev/?room=r-1&token=tok');
    const joined = resolveJoin(pageQueryParams(new URL(link).search), '', link);
    assert.equal(joined.base, 'wss://selvage.dontblameme.dev');
    // A base names an origin here: the socket and the meta read are its two
    // paths, so a base that already carried `/session` would derive
    // `/session/session` and `/session/meta`.
    assert.equal(
      sessionUrl(joined.base, 'r-1', 'tok'),
      'wss://selvage.dontblameme.dev/session?room=r-1&token=tok',
    );
    assert.equal(metaUrl(joined.base), 'https://selvage.dontblameme.dev/meta');
  });

  it('a link read from the address bar takes the page\'s own origin', () => {
    // The page was served by the room's server, so the address that served it
    // is the address the room lives on.
    assert.deepEqual(
      resolveJoin(new URLSearchParams('room=r-1&token=tok'), '', 'https://edit.example/'),
      { base: 'wss://edit.example', room: 'r-1', token: 'tok', fragment: '' },
    );
    assert.deepEqual(
      resolveJoin(new URLSearchParams('room=r-1&token=tok'), '', 'http://127.0.0.1:8080/'),
      { base: 'ws://127.0.0.1:8080', room: 'r-1', token: 'tok', fragment: '' },
    );
    // A trailing query on the page's own address is not part of it, and a trailing fragment is
    // carried rather than read as part of the address: `§5.1`'s fragment is the room key and the
    // host key, and one that names neither (`#x`) is a fragment the engine refuses where it reads
    // it (`peer.ts`).
    assert.deepEqual(
      resolveJoin(new URLSearchParams('room=r-1&token=tok'), '', 'https://edit.example/?debug=1#x'),
      { base: 'wss://edit.example', room: 'r-1', token: 'tok', fragment: '#x' },
    );
  });

  it('a link pasted into a page on another origin talks to the link\'s server', () => {
    // The case a `server=` parameter used to carry: the page is served from one
    // origin and the room lives on another. The guest's page must dial the
    // room's server — the link's own origin — and never the page's.
    assert.deepEqual(
      resolveJoin(new URLSearchParams(), 'https://room.example/?room=r-1&token=tok', PAGE),
      { base: 'wss://room.example', room: 'r-1', token: 'tok', fragment: '' },
    );
    assert.deepEqual(
      resolveJoin(new URLSearchParams(), 'http://room.example:8080/?room=r-1&token=tok', PAGE),
      { base: 'ws://room.example:8080', room: 'r-1', token: 'tok', fragment: '' },
    );
  });

  it('a stale `server=` in a link does not move the join off the link\'s origin', () => {
    // Links written before the origin carried the server still name a room; the
    // parameter names nothing the page reads, so the join is the link's origin.
    assert.deepEqual(
      resolveJoin(
        new URLSearchParams('room=r-1&token=tok&server=wss%3A%2F%2Felsewhere.example'),
        '',
        'https://room.example/',
      ),
      { base: 'wss://room.example', room: 'r-1', token: 'tok', fragment: '' },
    );
    assert.deepEqual(
      resolveJoin(
        new URLSearchParams(),
        'https://room.example/?room=r-1&token=tok&server=wss%3A%2F%2Felsewhere.example',
        PAGE,
      ),
      { base: 'wss://room.example', room: 'r-1', token: 'tok', fragment: '' },
    );
  });

  it('a page that names no server of its own is refused in the card\'s words', () => {
    // A `file://` page is served by no server, so it cannot say where the room
    // lives. There is no default to fall back to, and a default is an address
    // the room may not be on.
    assert.throws(
      () => resolveJoin(new URLSearchParams('room=r-1&token=tok'), '', 'file:///srv/dist/index.html'),
      /This page names no server to join\. Open the link the host sent you\./,
    );
  });

  it('a pasted wire invite streams to a room whose server serves no page', () => {
    assert.deepEqual(
      resolveJoin(new URLSearchParams(), 'ws://other:8080/session?room=r-1&token=tok', PAGE),
      { base: 'ws://other:8080', room: 'r-1', token: 'tok', fragment: '' },
    );
  });

  it('a wire invite spelled in another case names the same server, and links back as a page', () => {
    // The base becomes the page's `https://` read and its socket URL, so the
    // scheme is read in the one case those rules are written in; the share link
    // the bar offers is the room's own page and never the wire URL.
    const joined = resolveJoin(new URLSearchParams(), 'WS://other:8080/session?room=r-1&token=tok', PAGE);
    assert.deepEqual(joined, { base: 'ws://other:8080', room: 'r-1', token: 'tok', fragment: '' });
    assert.equal(
      buildShareLink(joined.base, joined.room, joined.token),
      'http://other:8080/?room=r-1&token=tok',
    );
    assert.equal(schemeMatchBase(joined.base, 'https:'), 'wss://other:8080');
  });

  it('a wire invite the engine reads to one base is joined on that server', () => {
    // The spelling a special scheme does not need, and the http(s) form of the same
    // address: the engine reads each into one base (`sessionBase`), so the server the
    // link named is the server the page dials, and the `/meta` read and the socket are
    // derived from one spelling rather than from two.
    for (const [text, base, meta] of [
      ['ws:other:8080/session?room=r-1&token=tok', 'ws://other:8080', 'https://other:8080/meta'],
      ['wss:other:8080/session?room=r-1&token=tok', 'wss://other:8080', 'https://other:8080/meta'],
      ['http://other:8080/session?room=r-1&token=tok', 'ws://other:8080', 'https://other:8080/meta'],
      ['https://other:8080/session?room=r-1&token=tok', 'wss://other:8080', 'https://other:8080/meta'],
      [
        'ws://other:8080/prefix/session?room=r-1&token=tok',
        'ws://other:8080/prefix',
        'https://other:8080/prefix/meta',
      ],
    ] as const) {
      assert.deepEqual(
        resolveJoin(new URLSearchParams(), text, PAGE),
        { base, room: 'r-1', token: 'tok', fragment: '' },
        text,
      );
      // And on the page the room is served from, the socket the base derives is TLS, and
      // the `/meta` read is the same base's own path over TLS.
      const matched = schemeMatchBase(base, 'https:');
      assert.equal(new URL(sessionUrl(matched, 'r-1', 'tok')).protocol, 'wss:', text);
      assert.equal(metaUrl(matched), meta, text);
    }
  });

  it('an https page dials the room\'s server over TLS, whatever the page derived', () => {
    const own = resolveJoin(new URLSearchParams('room=r-1&token=tok'), '', 'https://edit.example/');
    assert.equal(schemeMatchBase(own.base, 'https:'), own.base);
  });

  it('a wire invite left without the `//` does not escape the TLS upgrade', () => {
    // `ws:/host/session` is a URL the parser reads by inserting the slashes, so a
    // base handed on as the link wrote it reaches the socket as a cleartext dial:
    // measured in Chromium on the built page, the invite below dials the plain port
    // with the room token in its request line. An `https:` page's rule is that it
    // makes no such subrequest, and this is the spelling that escaped it.
    for (const text of [
      'ws:/other:8080/session?room=r-1&token=tok',
      'ws:other:8080/session?room=r-1&token=tok',
      'WS:/other:8080/session?room=r-1&token=tok',
      'ws:\\other:8080/session?room=r-1&token=tok',
    ]) {
      const joined = resolveJoin(new URLSearchParams(), text, PAGE);
      // The base is the engine's reading of what the parser read: the two slashes it
      // inserted, the path `session` was stripped from, and no trailing slash left on
      // the authority — one base, and one a socket would dial.
      assert.equal(joined.base, 'ws://other:8080', text);
      const base = schemeMatchBase(joined.base, 'https:');
      assert.equal(base, 'wss://other:8080', text);
      assert.equal(new URL(sessionUrl(base, joined.room, joined.token)).protocol, 'wss:', text);
      assert.equal(metaUrl(base), 'https://other:8080/meta', text);
    }
  });
});

describe('a page address read back as a server', () => {
  it('keeps the host, the port and a prefix, and drops the rest', () => {
    assert.equal(serverBaseOf('https://edit.example/?room=r-1&token=tok#frag'), 'wss://edit.example');
    assert.equal(serverBaseOf('http://127.0.0.1:8080/'), 'ws://127.0.0.1:8080');
    assert.equal(serverBaseOf('https://host:8443/proxy/'), 'wss://host:8443/proxy');
    // Neither the credentials nor the query name a server, so neither survives.
    assert.equal(serverBaseOf('https://user:secret@host/?debug=1'), 'wss://host');
  });

  it('names no server for an address no server serves', () => {
    assert.equal(serverBaseOf('file:///srv/dist/index.html'), '');
    assert.equal(serverBaseOf('not an address'), '');
    assert.equal(serverBaseOf(''), '');
    assert.equal(serverBaseOf('ws://edit.example/'), '');
  });

  it('round-trips through the page half', () => {
    for (const base of ['wss://host', 'ws://host:8080', 'wss://host:8443/proxy']) {
      assert.equal(serverBaseOf(pageOriginOf(base)), base, base);
    }
  });
});
