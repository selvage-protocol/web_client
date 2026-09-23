/**
 * The page's own name and version, pinned to the manifest it is released under.
 *
 * `session.hello`'s `client` is free-form client identification, for diagnostics, read by nothing
 * — which is exactly why it drifted: the page went on naming `web_client/0.1.0` while the manifest
 * was released as something else, and no check in this repository could see it. The identity is
 * written once, in `src/browser/client-id.ts`, and this file is what makes its second home — the
 * manifest — safe: a release that moves one and not the other fails here rather than publishing a
 * page that names a build it is not.
 *
 * The second test reads the shipped bundle instead of the source, because that is what a person
 * gets: a builder who reaches for a literal in `main.ts` again, or a `dist/` nobody rebuilt, is red
 * here as well as in `scripts/check-dist.sh`.
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CLIENT_ID } from '../src/browser/client-id.ts';

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe("the page's client identity", () => {
  it('is the manifest version, under the client name `web_client`', () => {
    assert.equal(
      CLIENT_ID,
      `web_client/${manifest.version}`,
      'the page names a version the manifest does not: bump both, or take the version from the manifest',
    );
  });

  it('is what the built bundle carries, so the page cannot name another build', () => {
    let app: string;
    try {
      app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
    } catch {
      assert.fail('dist/app.js is missing — run npm run build first');
    }
    assert.ok(
      app.includes(CLIENT_ID),
      `the built bundle does not carry ${CLIENT_ID}: it was not rebuilt, or main.ts sends another string`,
    );
  });
});
