/**
 * Page-origin share links: the guest link is the room's own page — its origin
 * is the server the room lives on — carrying `?room=&token=` and nothing else,
 * and a pasted page link reads back into the same join.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildShareLink, pageQueryParams, parsePageLink } from '../src/browser/share.ts';

describe('share links', () => {
  it('offers the room\'s own page, with no server in the query', () => {
    const link = buildShareLink('wss://edit.example', 'r-1', 'tok');
    assert.equal(link, 'https://edit.example/?room=r-1&token=tok');
    assert.ok(!/ws:\/\//i.test(link), `the wire scheme reached the link: ${link}`);
  });

  it('a plain server is linked over the scheme a browser speaks', () => {
    assert.equal(
      buildShareLink('ws://other:8080', 'r-1', 'tok'),
      'http://other:8080/?room=r-1&token=tok',
    );
    // A trailing slash on the base is not a second path.
    assert.equal(
      buildShareLink('ws://other:8080/', 'r-1', 'tok'),
      'http://other:8080/?room=r-1&token=tok',
    );
  });

  it('a server behind a prefix keeps it: the page is served from the same one', () => {
    assert.equal(
      buildShareLink('wss://host:8443/proxy', 'r-1', 'tok'),
      'https://host:8443/proxy/?room=r-1&token=tok',
    );
  });

  it('a pasted page link round-trips back into a join', () => {
    const link = buildShareLink('wss://other:8443', 'r-1', 'tok');
    assert.deepEqual(parsePageLink(link), {
      room: 'r-1',
      token: 'tok',
      origin: 'https://other:8443',
      fragment: '',
    });
    assert.equal(parsePageLink('ws://host:8080/session?room=r-1&token=tok'), undefined);
    assert.equal(parsePageLink('not a link'), undefined);
  });

  it('reads params in any order, extras ignored', () => {
    assert.deepEqual(
      parsePageLink('https://edit.example/?token=tok&room=r-1'),
      { room: 'r-1', token: 'tok', origin: 'https://edit.example', fragment: '' },
    );
    assert.deepEqual(
      parsePageLink('https://edit.example/?room=r-1&token=tok&debug=1&utm_source=x&foo=bar'),
      { room: 'r-1', token: 'tok', origin: 'https://edit.example', fragment: '' },
    );
  });

  it('a `server` parameter is an unknown parameter, and is ignored', () => {
    // Links written before the origin carried the server still name a room, and
    // the parameter names nothing the page reads (`PROTOCOL.md` §5.1: unknown
    // query parameters are ignored). The link's own origin is the server.
    assert.deepEqual(
      parsePageLink('https://edit.example/?room=r-1&token=tok&server=ws%3A%2F%2Fother%3A8080'),
      { room: 'r-1', token: 'tok', origin: 'https://edit.example', fragment: '' },
    );
  });

  it('carries the fragment, and reads no parameter out of it', () => {
    // `§5.1`'s fragment is the room key and the host key, and it is carried whole so the link can
    // be handed on. What it is never read as is a parameter: `#room=nope` does not rename the
    // room the query named.
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=tok#frag'), {
      room: 'r-1',
      token: 'tok',
      origin: 'https://edit.example',
      fragment: '#frag',
    });
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=tok#room=nope'), {
      room: 'r-1',
      token: 'tok',
      origin: 'https://edit.example',
      fragment: '#room=nope',
    });
  });

  it('a second ? separates params instead of gluing into the token', () => {
    // The owner failure: `?debug=1` appended to a link that already had a
    // query glued `?debug=1` into the token (`tok%3Fdebug%3D1` on rebuild).
    // A literal `?` past the first is a separator — values are
    // percent-encoded, so it can never be legitimate token data.
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=tok?debug=1'), {
      room: 'r-1',
      token: 'tok',
      origin: 'https://edit.example',
      fragment: '',
    });
    assert.deepEqual(pageQueryParams('?room=r-1&token=tok?debug=1').get('token'), 'tok');
    assert.deepEqual(pageQueryParams('?room=r-1&token=tok?debug=1').get('debug'), '1');
  });

  it('decodes values once', () => {
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=a%26b'), {
      room: 'r-1',
      token: 'a&b',
      origin: 'https://edit.example',
      fragment: '',
    });
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=a%253Fb'), {
      room: 'r-1',
      token: 'a%3Fb',
      origin: 'https://edit.example',
      fragment: '',
    });
  });
});

describe('page query params', () => {
  it('parses the address-bar search with real param semantics', () => {
    const params = pageQueryParams('?debug=1&room=r-1&token=tok');
    assert.equal(params.get('room'), 'r-1');
    assert.equal(params.get('token'), 'tok');
    assert.equal(params.get('debug'), '1');
  });
});
