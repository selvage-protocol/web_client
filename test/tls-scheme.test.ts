/**
 * The scheme-match rule: a page loaded over https must never emit a
 * ws:// or http:// subrequest — Firefox blocks those as mixed active
 * content while Chromium merely warns. So on an https page every server
 * base speaks TLS (ws:// -> wss://, http:// -> https://) and the default
 * is the TLS endpoint; an http page keeps the plaintext default.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { metaUrl, sessionUrl } from '../src/engine/index.ts';
import {
  DEFAULT_TLS_SERVER,
  defaultServerForPage,
  linkServerBase,
  schemeMatchBase,
} from '../src/browser/servers.ts';

const WS_DEFAULT = 'ws://100.64.0.3:8080';

describe('scheme-match rule', () => {
  it('an https page upgrades ws:// and http(s):// bases to a TLS socket', () => {
    assert.equal(schemeMatchBase('ws://100.64.0.3:8080', 'https:'), 'wss://100.64.0.3:8080');
    // An http(s):// base names the same server: the socket still needs a
    // ws(s):// base, and the engine derives https:// meta from wss://.
    assert.equal(schemeMatchBase('http://100.64.0.3:8080', 'https:'), 'wss://100.64.0.3:8080');
    assert.equal(schemeMatchBase('https://other:8443', 'https:'), 'wss://other:8443');
    assert.equal(
      schemeMatchBase('ws://other:8080', 'https:'),
      'wss://other:8080',
    );
  });

  it('TLS bases pass through untouched', () => {
    assert.equal(schemeMatchBase(DEFAULT_TLS_SERVER, 'https:'), DEFAULT_TLS_SERVER);
    assert.equal(schemeMatchBase('wss://other:8080', 'https:'), 'wss://other:8080');
  });

  it('an http page keeps whatever base it was given', () => {
    assert.equal(schemeMatchBase('ws://100.64.0.3:8080', 'http:'), 'ws://100.64.0.3:8080');
    assert.equal(schemeMatchBase(DEFAULT_TLS_SERVER, 'http:'), DEFAULT_TLS_SERVER);
  });

  it('the https default is the TLS endpoint, the http default the plaintext one', () => {
    assert.equal(defaultServerForPage('https:', WS_DEFAULT), DEFAULT_TLS_SERVER);
    assert.equal(defaultServerForPage('http:', WS_DEFAULT), WS_DEFAULT);
    assert.ok(DEFAULT_TLS_SERVER.startsWith('wss://'), DEFAULT_TLS_SERVER);
  });

  it('an https page never derives a ws:// or http:// subrequest URL', () => {
    for (const base of [
      'ws://100.64.0.3:8080',
      'ws://other:8080',
      'http://100.64.0.3:8080',
      DEFAULT_TLS_SERVER,
      'https://other:8443',
    ]) {
      const matched = schemeMatchBase(base, 'https:');
      const socket = sessionUrl(matched, 'r-1', 'tok');
      const meta = metaUrl(matched);
      assert.ok(socket.startsWith('wss://'), `${base} -> socket ${socket}`);
      assert.ok(!socket.startsWith('ws://'), `${base} -> socket ${socket}`);
      assert.ok(meta.startsWith('https://'), `${base} -> meta ${meta}`);
    }
  });
});

describe('the server a link may name', () => {
  it('takes the schemes a room can live on, and nothing else', () => {
    for (const base of [
      'ws://other:8080',
      'wss://other:8443',
      'http://other:8080',
      'https://other:8443',
      'wss://other:8443/proxy',
      'ws://other:8080/',
    ]) {
      assert.equal(linkServerBase(base), base);
    }
    for (const base of [
      'ftp://other:8080',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,x',
      'other:8080',
      '127.0.0.1:8099',
      '//other:8080',
      '/session',
      '',
      '   ',
      'ws://',
    ]) {
      assert.equal(linkServerBase(base), undefined, `${base} was admitted`);
    }
  });

  it('refuses credentials, a fragment and a query', () => {
    // Each of these puts an address in the page's request that the link does
    // not read as naming.
    for (const base of [
      'ws://user:secret@other:8080',
      'ws://user@other:8080',
      'ws://other:8080#frag',
      'ws://other:8080/session?room=r-1',
      'wss://other:8443/?debug=1',
    ]) {
      assert.equal(linkServerBase(base), undefined, `${base} was admitted`);
    }
  });
});
