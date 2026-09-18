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
import { cpSync, mkdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderIcon } from '../scripts/dist-icons.mjs';

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

/** The four icons the build renders from the opaque mark. */
const RENDERED_ICONS = ['favicon-32x32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];

/**
 * The clock chunks an ImageMagick PNG can carry: the `tIME` chunk, and a `tEXt`
 * key such as `date:create`/`date:modify`/`date:timestamp`.
 */
function clockChunks(png: Buffer): string[] {
  const found: string[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'tIME') {
      found.push('tIME');
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const key = body.toString('latin1').split('\0', 1)[0] ?? '';
      if (key.startsWith('date:')) found.push(key);
    }
    at += 12 + length;
    if (type === 'IEND') break;
  }
  return found;
}

describe('the build-rendered icons', () => {
  it('carry no clock chunk, from the build or from the source file', () => {
    for (const icon of RENDERED_ICONS) {
      assert.deepEqual(
        clockChunks(readFileSync(resolve(root, 'dist', icon))),
        [],
        `dist/${icon} carries a clock: a clone would rebuild different bytes`,
      );
    }
  });

  it('render the same bytes from the same mark, whatever its mtime', () => {
    const scratch = resolve(root, '.tmp/icon-determinism');
    mkdirSync(scratch, { recursive: true });
    try {
      const rendered: string[] = [];
      // Two copies of the same mark, stamped as a fresh clone would leave them.
      for (const [at, stamp] of [1_000_000_000_000, 1_500_000_000_000].entries()) {
        const copy = resolve(scratch, `mark-${at}.png`);
        cpSync(resolve(root, 'public/mark-opaque.png'), copy);
        utimesSync(copy, new Date(stamp), new Date(stamp));
        const out = resolve(scratch, `icon-${at}.png`);
        renderIcon(copy, 192, out);
        rendered.push(out);
      }
      assert.equal(
        sha256(rendered[0] as string),
        sha256(rendered[1] as string),
        'the same mark at two mtimes rendered two different icons',
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('are rendered through that one renderer, never an ad-hoc command', () => {
    const build = readFileSync(resolve(root, 'scripts/build.mjs'), 'utf8');
    assert.match(build, /renderIcon\(/, 'the build stopped using the tested renderer');
  });
});
