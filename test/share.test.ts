/**
 * Page-origin share links: the guest flow offers an `https://` (or
 * page-origin) link, `server` only for non-default rooms, and a pasted page
 * link reads back into the same join.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SERVER_BASE } from '../src/browser/servers.ts';
import { buildShareLink, pageQueryParams, parsePageLink, shareOrigin } from '../src/browser/share.ts';

describe('share links', () => {
  it('offers a page-origin https link with no server for the default room', () => {
    const link = buildShareLink('https://edit.example', '/', 'r-1', 'tok', DEFAULT_SERVER_BASE, DEFAULT_SERVER_BASE);
    assert.ok(link.startsWith('https://'));
    assert.equal(link, 'https://edit.example/?room=r-1&token=tok');
  });

  it('keeps server for non-default rooms', () => {
    const link = buildShareLink(
      'https://edit.example',
      '/',
      'r-1',
      'tok',
      'ws://other:8080',
      DEFAULT_SERVER_BASE,
    );
    assert.equal(link, 'https://edit.example/?room=r-1&token=tok&server=ws%3A%2F%2Fother%3A8080');
  });

  it('falls back to the public origin while served locally', () => {
    assert.equal(
      shareOrigin('http://127.0.0.1:8081', 'https://edit.example'),
      'https://edit.example',
    );
    assert.equal(shareOrigin('https://edit.example', 'https://edit.example'), 'https://edit.example');
    assert.equal(shareOrigin('http://127.0.0.1:8081'), 'http://127.0.0.1:8081');
  });

  it('a pasted page link round-trips back into a join', () => {
    const link = buildShareLink('https://edit.example', '/', 'r-1', 'tok', 'ws://other:8080', DEFAULT_SERVER_BASE);
    assert.deepEqual(parsePageLink(link), { room: 'r-1', token: 'tok', server: 'ws://other:8080' });
    const bare = buildShareLink('https://edit.example', '/', 'r-1', 'tok', DEFAULT_SERVER_BASE, DEFAULT_SERVER_BASE);
    assert.deepEqual(parsePageLink(bare), { room: 'r-1', token: 'tok' });
    assert.equal(parsePageLink('ws://host:8080/session?room=r-1&token=tok'), undefined);
    assert.equal(parsePageLink('not a link'), undefined);
  });

  it('reads params in any order, extras ignored', () => {
    assert.deepEqual(
      parsePageLink('https://edit.example/?token=tok&room=r-1'),
      { room: 'r-1', token: 'tok' },
    );
    assert.deepEqual(
      parsePageLink('https://edit.example/?room=r-1&token=tok&debug=1&utm_source=x&foo=bar'),
      { room: 'r-1', token: 'tok' },
    );
    assert.deepEqual(
      parsePageLink('https://edit.example/?debug=1&server=ws%3A%2F%2Fother%3A8080&room=r-1&token=tok'),
      { room: 'r-1', token: 'tok', server: 'ws://other:8080' },
    );
  });

  it('ignores fragments', () => {
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=tok#frag'), {
      room: 'r-1',
      token: 'tok',
    });
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=tok#room=nope'), {
      room: 'r-1',
      token: 'tok',
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
    });
    assert.deepEqual(pageQueryParams('?room=r-1&token=tok?debug=1').get('token'), 'tok');
    assert.deepEqual(pageQueryParams('?room=r-1&token=tok?debug=1').get('debug'), '1');
  });

  it('decodes values once', () => {
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=a%26b'), {
      room: 'r-1',
      token: 'a&b',
    });
    assert.deepEqual(parsePageLink('https://edit.example/?room=r-1&token=a%253Fb'), {
      room: 'r-1',
      token: 'a%3Fb',
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
