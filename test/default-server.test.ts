/**
 * The shipped default: the public demo, which answers the page, `/meta` and
 * `/session` from one origin. What a link means when it names no server, what
 * the engine derives from the base, and that the link the page makes comes
 * back to the server the guest's page would dial.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { metaUrl, sessionUrl } from '../src/engine/index.ts';
import { DEFAULT_SERVER_BASE, schemeMatchBase } from '../src/browser/servers.ts';
import { resolveJoin } from '../src/browser/join.ts';
import { buildShareLink, pageQueryParams, shareOrigin } from '../src/browser/share.ts';

describe('the default server', () => {
  it('is the demo origin, with no path of its own to double the endpoint', () => {
    const url = new URL(DEFAULT_SERVER_BASE);
    assert.equal(url.protocol, 'wss:');
    assert.equal(url.host, 'selvage.dontblameme.dev');
    // A base names an origin here: the socket and the meta read are its two
    // paths, so a base that already carried `/session` would derive
    // `/session/session` and `/session/meta`.
    assert.equal(url.pathname, '/');
    assert.equal(
      sessionUrl(DEFAULT_SERVER_BASE, 'r-1', 'tok'),
      'wss://selvage.dontblameme.dev/session?room=r-1&token=tok',
    );
    assert.equal(metaUrl(DEFAULT_SERVER_BASE), 'https://selvage.dontblameme.dev/meta');
  });

  it('a link the demo page makes rejoins the demo, and names no server', () => {
    const link = buildShareLink(
      shareOrigin('https://selvage.dontblameme.dev'),
      '/',
      'r-1',
      'tok',
      DEFAULT_SERVER_BASE,
      DEFAULT_SERVER_BASE,
    );
    assert.equal(link, 'https://selvage.dontblameme.dev/?room=r-1&token=tok');
    const joined = resolveJoin(pageQueryParams(new URL(link).search), '', DEFAULT_SERVER_BASE);
    assert.equal(joined.base, DEFAULT_SERVER_BASE);
    // The guest's page is https and scheme-matches the base the host left
    // out, so the guest dials the socket the host is on.
    assert.equal(schemeMatchBase(joined.base, 'https:'), DEFAULT_SERVER_BASE);
  });

  it('a room somewhere else still names its server in the link', () => {
    const link = buildShareLink(
      'https://selvage.dontblameme.dev',
      '/',
      'r-1',
      'tok',
      'wss://other:8443',
      DEFAULT_SERVER_BASE,
    );
    assert.equal(link, 'https://selvage.dontblameme.dev/?room=r-1&token=tok&server=wss%3A%2F%2Fother%3A8443');
  });
});
