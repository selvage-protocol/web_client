/**
 * Identity: the page carries the site's own mark — the owner's `svp` monogram
 * in Mocha/mauve — as the sized favicon set, the touch icon, the manifest, the
 * chrome's mark and the OpenGraph image. Nothing here is redrawn: the sources
 * are byte-identical copies of the site's files, the sized icons are rendered
 * by the build from the opaque master, and the mark in the shell is 104 px of
 * the transparent master, decoded here and checked against that same renderer.
 * The site keeps its opaque mark as the OpenGraph image (`app/`), which is the
 * same file this page serves as `mark-opaque.png`.
 *
 * The site's `app/icon.svg` — the vector monogram this page used to copy as
 * `favicon.svg` — is gone: its `clipPath` pointed at a `<g>` and the whole
 * monogram was clipped away, so it rendered nothing but its background plate.
 * The site's icon set is its own pixels now, and this page's tab is the rasters
 * below.
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
      ['public/mark-opaque.png', 'app/opengraph-image.png'],
      ['public/mark-transparent.png', 'public/mark-transparent.png'],
    ]) {
      assert.equal(sha256(resolve(root, ours)), siteSha256(theirs), ours);
    }
  });

  it('wires favicon, touch icon, manifest, theme colour and OpenGraph', () => {
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    assert.match(html, /rel="icon" href="favicon-16x16\.png" sizes="16x16"/);
    assert.match(html, /rel="icon" href="favicon-32x32\.png" sizes="32x32"/);
    assert.match(html, /rel="icon" href="icon-48\.png" sizes="48x48"/);
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
    // One rule carries the mark's bytes and both marks wear it: nothing to
    // fetch, and no element that could paint alt text or a broken-image box
    // (see test/join-paint.test.ts for the first-frame side).
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    assert.match(html, /<span id="brand"><span class="mark" aria-hidden="true"><\/span>Selvage/);
    assert.equal(
      (html.match(/<span class="mark" aria-hidden="true"><\/span>/g) ?? []).length,
      2,
      'the card and the brand do not both wear the mark',
    );
    assert.ok(!/<img[^>]*mark-transparent/.test(html), 'the chrome still fetches the PNG mark');
  });

  it('keeps no placeholder favicon', () => {
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    assert.doesNotMatch(html, /data:image\/svg\+xml/);
  });

  it("carries the mark in the shell as the owner's pixels, resampled not redrawn", () => {
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    const found = html.match(/url\("data:image\/png;base64,([^"]+)"\)/);
    assert.ok(found !== null, 'the shell carries no inlined mark');
    const inlined = Buffer.from(found[1] ?? '', 'base64');
    // 104 px is the card's 3.25rem at 2x: the largest the mark is ever shown.
    assert.equal(inlined.readUInt32BE(16), 104, 'the inlined mark is not 104 px wide');
    assert.equal(inlined.readUInt32BE(20), 104, 'the inlined mark is not 104 px tall');
    const scratch = resolve(root, '.tmp/mark-inline');
    mkdirSync(scratch, { recursive: true });
    try {
      const rendered = resolve(scratch, 'mark-104.png');
      renderIcon(resolve(root, 'public/mark-transparent.png'), 104, rendered);
      assert.equal(
        sha256(rendered),
        createHash('sha256').update(inlined).digest('hex'),
        'the inlined mark is not what the renderer makes of the site\'s mark',
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

/** The four icons the build renders from the opaque mark. */
const RENDERED_ICONS = [
  'favicon-16x16.png',
  'favicon-32x32.png',
  'icon-48.png',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
];

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
