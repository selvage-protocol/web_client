/**
 * Identity: the page carries the site's own mark — the owner's `svp` monogram
 * in Mocha/mauve — as the sized favicon set, the touch icon, the manifest, the
 * chrome's mark and the OpenGraph image. Nothing here is redrawn: the sources
 * are byte-identical copies of the site's files, the sized icons are rendered
 * by the build from the opaque master, and the mark in the shell is 104 px of
 * the transparent master, levelled the way the site levels its own nav copy
 * (`MARK_GAMMA`, `scripts/dist-icons.mjs`), decoded here and checked against
 * that same renderer. The site keeps its opaque mark as the OpenGraph image
 * (`app/`), which is the same file this page serves as `mark-opaque.png`.
 *
 * The site's `app/icon.svg` — the vector monogram this page used to copy as
 * `favicon.svg` — is gone: its `clipPath` pointed at a `<g>` and the whole
 * monogram was clipped away, so it rendered nothing but its background plate.
 * The site's icon set is its own pixels now, and this page's tab is the rasters
 * below.
 *
 * The one test that reads the `site` checkout beside this one skips, with the
 * reason, where there is no such checkout — a single-repository CI job, or a
 * copy of this repository standing on its own. Everything else here needs this
 * checkout alone and runs everywhere.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MARK_GAMMA, renderIcon } from '../scripts/dist-icons.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The `site` checkout beside this one, or `undefined` where there is none.
 *
 * A worktree lives under `<repo>/.worktrees/<name>`, so the parent of *this*
 * directory is not the parent that holds the siblings: the repository's own
 * common git directory is, in a checkout and in a worktree alike. A copy that
 * is not a git checkout at all falls back to the directory itself, which is
 * where a plain clone's sibling would be.
 */
function siblingSite(): string | undefined {
  let repo = root;
  try {
    const common = execFileSync(
      'git',
      ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8' },
    ).trim();
    if (common !== '') {
      repo = dirname(common);
    }
  } catch {
    // Not a git checkout: the directory this test sits in is the best answer there is.
  }
  const site = resolve(repo, '..', 'site');
  return existsSync(site) ? site : undefined;
}

const site = siblingSite();
/** Why the byte-for-byte comparison cannot run here, or `false` where it can. */
const noSibling =
  site === undefined &&
  'no `site` checkout beside this one: the mark cannot be compared byte for byte with the site that owns it';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * The site's hash for one of its files. The sibling checkout is edited in
 * parallel, so an in-flight edit can have the file gone from its working tree:
 * the blob its history carries is the same file, and the comparison stays
 * byte-for-byte against the site rather than against a redraw.
 */
function siteSha256(path) {
  const at = resolve(site as string, path);
  try {
    return sha256(at);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return createHash('sha256')
      .update(execFileSync('git', ['-C', site as string, 'show', `HEAD:${path}`]))
      .digest('hex');
  }
}

describe('identity', () => {
  it('ships the site mark byte-identical, never redrawn', { skip: noSibling }, () => {
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
      /property="og:description" content="Join a live editing session in your browser/,
    );
    assert.match(html, /property="og:image" content="mark-opaque\.png"/);
  });

  it('brands the page chrome with the mark, and the mark alone', () => {
    // One rule carries the mark's bytes and both marks wear it: nothing to
    // fetch, and no element that could paint alt text or a broken-image box
    // (see test/join-paint.test.ts for the first-frame side).
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    // The mark carries the brand and the words beside it carry the one fact the bar has about
    // *which* session this is: whose room, or whose folder is exposed (design §3.1). A `Selvage`
    // wordmark in this span would be the brand twice and the fact never.
    assert.match(
      html,
      /<span id="brand"><span class="mark" aria-hidden="true"><\/span><span id="session-identity"><\/span><\/span>/,
    );
    const brand = html.slice(html.indexOf('<span id="brand">'), html.indexOf('id="share-group"'));
    assert.ok(!/>[^<]*Selvage/.test(brand), `the wordmark is back beside the mark: ${brand}`);
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
      renderIcon(resolve(root, 'public/mark-transparent.png'), 104, rendered, { gamma: MARK_GAMMA });
      assert.equal(
        sha256(rendered),
        createHash('sha256').update(inlined).digest('hex'),
        'the inlined mark is not what the renderer makes of the site\'s mark',
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('levels the mark for the dark ground it lands on', () => {
    // The owner's export is a shaded wordmark, dark enough that on this page's card it reads as a
    // smudge: the site measured the same defect on its own bar and fixed it the same way, and this
    // is the page's half of that — the mark's own pixels, composited over the ground the card
    // paints, at the non-text floor WCAG sets for a mark beside text. A derivative that goes dark
    // again fails here; the unlevelled render measures 1.72:1 and fails it.
    const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
    const ground = /--card:\s*(#[0-9a-f]{6})/i.exec(html)?.[1] ?? '';
    assert.notEqual(ground, '', 'the card\'s own ground is not in the stylesheet');
    const inlined = Buffer.from(
      html.match(/url\("data:image\/png;base64,([^"]+)"\)/)?.[1] ?? '',
      'base64',
    );
    const scratch = resolve(root, '.tmp/mark-level');
    mkdirSync(scratch, { recursive: true });
    try {
      const rendered = resolve(scratch, 'mark-104.png');
      writeFileSync(rendered, inlined);
      const ink = markInk(rendered, ground);
      assert.ok(
        ink.ratio >= NON_TEXT_MIN,
        `the mark's typical ink pixel is ${ink.colour} on ${ground} = ${ink.ratio.toFixed(2)}:1, under the ${NON_TEXT_MIN}:1 floor (${ink.pixels} ink pixels)`,
      );
      // And the measurement reaches the mark: a transparent field would be no ink at all.
      assert.ok(ink.pixels > 100, `the mark has ${ink.pixels} ink pixels, so nothing was measured`);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

/** The floor a non-text mark beside text has to clear (`WCAG` 1.4.11). */
const NON_TEXT_MIN = 3;

/** Half coverage: less opaque than this is a glyph's antialiased fringe, not ink. */
const MARK_INK_ALPHA = 50;

/**
 * The mark's typical ink pixel over `ground`, its count and the contrast ratio between them.
 *
 * The mark is shown as pixels rather than as a token, so the only way to measure the tone it
 * paints is to read them: ImageMagick decodes the PNG to its own 8-bit RGBA samples (it is
 * already the gate's renderer, so no second decoder enters the suite for one file), the pixels
 * are composited over the ground the card paints them on, and the median of what is left is the
 * mark as a reader sees it. The median rather than the mean, so a mark that is dark except for a
 * highlight does not pass; alpha above half coverage, so the transparent field beside the glyphs
 * is not counted as ink at all.
 */
function markInk(path: string, ground: string) {
  const png = readFileSync(path);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const raster = execFileSync('magick', [path, '-depth', '8', 'rgba:-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(raster.length, width * height * 4, 'the decoder did not return the mark\'s pixels');
  const base = [1, 3, 5].map((at) => parseInt(ground.slice(at, at + 2), 16));
  const ink: { lum: number; colour: string }[] = [];
  for (let at = 0; at < raster.length; at += 4) {
    const alpha = (raster[at + 3] as number) / 255;
    if ((raster[at + 3] as number) <= MARK_INK_ALPHA) {
      continue;
    }
    const pixel = [0, 1, 2].map((channel) =>
      Math.round((raster[at + channel] as number) * alpha + base[channel]! * (1 - alpha)),
    );
    const colour = `#${pixel.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    ink.push({ lum: relativeLuminance(pixel), colour });
  }
  assert.ok(ink.length > 0, 'the mark has no pixel above half coverage');
  ink.sort((a, b) => a.lum - b.lum);
  const median = ink[Math.floor(ink.length / 2)]!;
  const groundLum = relativeLuminance(base);
  return {
    colour: median.colour,
    pixels: ink.length,
    ratio: (Math.max(median.lum, groundLum) + 0.05) / (Math.min(median.lum, groundLum) + 0.05),
  };
}

/** WCAG's relative luminance of an sRGB triple. */
function relativeLuminance(rgb: readonly number[]): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
}

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
