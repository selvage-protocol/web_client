/**
 * Identity: the page carries the site's own mark — the owner's `svp` monogram
 * in Mocha/mauve — as favicon, touch icon, manifest, header brand and
 * OpenGraph image. Nothing here is redrawn: the sources are byte-identical
 * copies of the site's files, and the sized icons are rendered by the build.
 * The site keeps its opaque mark as the OpenGraph image (`app/`), which is the
 * same file this page serves as `mark-opaque.png`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(root, '..', 'site');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * The site's hash for one of its files. The sibling checkout is edited in
 * parallel, so an in-flight edit can have the file gone from its working tree:
 * the blob its history carries is the same file, and the comparison stays
 * byte-for-byte against the site rather than against a redraw.
 */
function siteSha256(path) {
  try {
    return sha256(resolve(site, path));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return createHash('sha256')
      .update(execFileSync('git', ['-C', site, 'show', `HEAD:${path}`]))
      .digest('hex');
  }
}

describe('identity', () => {
  it('ships the site mark byte-identical, never redrawn', () => {
    for (const [ours, theirs] of [
      ['public/favicon.svg', 'app/icon.svg'],
      ['public/mark-opaque.png', 'app/opengraph-image.png'],
      ['public/mark-transparent.png', 'public/mark-transparent.png'],
    ]) {
      assert.equal(sha256(resolve(root, ours)), siteSha256(theirs), ours);
    }
  });

  it('wires favicon, touch icon, manifest, theme colour and OpenGraph', () => {
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    assert.match(html, /rel="icon" href="favicon\.svg" type="image\/svg\+xml"/);
    assert.match(html, /rel="icon" href="favicon-32x32\.png" sizes="32x32"/);
    assert.match(html, /rel="apple-touch-icon" href="apple-touch-icon\.png"/);
    assert.match(html, /rel="manifest" href="site\.webmanifest"/);
    assert.match(html, /name="theme-color" content="#1e1e2e"/);
    assert.match(html, /property="og:title" content="Selvage — shared editing in the browser"/);
    assert.match(
      html,
      /property="og:description" content="This page joins a live editing session as a guest/,
    );
    assert.match(html, /property="og:image" content="mark-opaque\.png"/);
  });

  it('brands the page chrome with the mark', () => {
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    assert.match(html, /<img src="mark-transparent\.png" alt=""[^>]*>Selvage/);
    assert.match(html, /<img class="mark" src="mark-transparent\.png" alt="Selvage mark"/);
  });

  it('keeps no placeholder favicon', () => {
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    assert.doesNotMatch(html, /data:image\/svg\+xml/);
  });
});
