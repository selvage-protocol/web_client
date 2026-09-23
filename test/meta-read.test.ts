/**
 * The card's read of its own origin: three answers, told apart.
 *
 * Two states used to be one. `readMeta` in `main.ts` returned `undefined` for both "this origin
 * answered and was not a Selvage server" and "nothing answered in time", so a `selvaged` whose
 * `/meta` took longer than the deadline was reported to a person as a page "not served by a
 * Selvage server", with the host action withdrawn for the life of the load. This file pins the
 * two facts apart: a response that arrived is an answer about the server whatever it was, and a
 * deadline that passed is not.
 *
 * The doubles are the fetch the engine is handed (`fetchMeta`'s own seam), so what is exercised
 * is this module's reading of a real response object rather than a stub of its own shape.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isSelvageMeta, readServerMeta } from '../src/browser/meta-read.ts';

/** What a real `selvaged` answers, as `PROTOCOL.md` §2 defines it. */
const REAL_META = {
  server: 'selvaged/0.3.1',
  wire_versions: ['selvage/1', 'selvage/2'],
  capabilities: ['y-protocols/1', 'awareness', 'open-document-set', 'host-reclaim'],
  keepalive: {
    ping_interval_ms: 30000,
    awareness_renew_ms: 15000,
    awareness_expire_ms: 30000,
    room_grace_ms: 30000,
  },
  roles: ['host', 'guest'],
};

/** A fetch that answers `/meta` with `body` exactly once. */
function answering(body: string, init: ResponseInit = {}): typeof fetch {
  return () => Promise.resolve(new Response(body, { status: 200, ...init }));
}

/** A fetch that never answers, and rejects the way a browser does when the deadline aborts it. */
function neverAnswers(): typeof fetch {
  return (_input, options) =>
    new Promise((_resolve, reject) => {
      const abort = (): void => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      const signal = options?.signal;
      if (signal === undefined) {
        return;
      }
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    });
}

/** A fetch whose headers arrive and whose body never does — the deadline's other half. */
function headersOnly(): typeof fetch {
  return (_input, options) => {
    const body = new ReadableStream({
      start(controller) {
        options?.signal?.addEventListener('abort', () => {
          controller.error(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        });
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
}

const BASE = 'ws://127.0.0.1:8133';

describe('what a /meta body has to be to be a Selvage server', () => {
  it('recognises the body the spec defines', () => {
    assert.equal(isSelvageMeta(REAL_META), true);
  });

  it('refuses the one that answered nothing about itself', () => {
    // M2: an origin that answers `{}` at /meta is not a Selvage server, and a card that took it
    // for one offered a button whose only outcome was a refusal deeper in.
    assert.equal(isSelvageMeta({}), false);
    assert.equal(isSelvageMeta({ hello: 'world', version: 3 }), false);
  });

  it('refuses an empty version list, which is not a server that seats something', () => {
    assert.equal(isSelvageMeta({ ...REAL_META, wire_versions: [] }), false);
  });

  it('refuses the shapes that are not a JSON object at all', () => {
    for (const body of [null, undefined, 42, 'selvage', [REAL_META]]) {
      assert.equal(isSelvageMeta(body), false, `${JSON.stringify(body)} was taken for a server`);
    }
  });

  it('takes a server that seats no version-1 wire, which is a Selvage server without `roles`', () => {
    // §2: `roles` is the one member a `selvage/2`-only server has nothing to put in, and the
    // member leaves the body with that version — so requiring it would refuse a real server.
    const { roles, ...sealedOnly } = REAL_META;
    assert.deepEqual(roles, ['host', 'guest']);
    assert.equal(isSelvageMeta({ ...sealedOnly, wire_versions: ['selvage/2'] }), true);
  });
});

describe('the three answers a read can give', () => {
  it('answers as a Selvage server, with the body', async () => {
    const read = await readServerMeta(BASE, { fetchImpl: answering(JSON.stringify(REAL_META)) });
    assert.equal(read.kind, 'server');
    assert.deepEqual(read.kind === 'server' ? read.meta : undefined, REAL_META);
  });

  it('answers as something else where the origin is not a Selvage server', async () => {
    const empty = await readServerMeta(BASE, { fetchImpl: answering('{}') });
    assert.equal(empty.kind, 'not-a-server');
    const html = await readServerMeta(BASE, {
      fetchImpl: answering('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } }),
    });
    assert.equal(html.kind, 'not-a-server');
  });

  it('says nothing where the deadline passed', async () => {
    const read = await readServerMeta(BASE, { fetchImpl: neverAnswers(), timeoutMs: 20 });
    assert.equal(read.kind, 'no-answer');
  });

  it('says nothing where the connection was refused', async () => {
    const read = await readServerMeta(BASE, {
      fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
    });
    assert.equal(read.kind, 'no-answer');
  });

  it('says nothing where the headers arrived and the body did not', async () => {
    // The headers are not the server's answer about itself: a body still arriving when the
    // deadline passes is the same no-answer as a server that never picked up.
    const read = await readServerMeta(BASE, { fetchImpl: headersOnly(), timeoutMs: 20 });
    assert.equal(read.kind, 'no-answer');
  });

  it('says nothing where there is no fetch to make the ask with', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    // The page always has one; a standalone caller may not, and that is not a claim about a
    // server either.
    Object.defineProperty(globalThis, 'fetch', { value: undefined, configurable: true });
    try {
      const read = await readServerMeta(BASE);
      assert.equal(read.kind, 'no-answer');
    } finally {
      if (saved !== undefined) {
        Object.defineProperty(globalThis, 'fetch', saved);
      }
    }
  });
});
