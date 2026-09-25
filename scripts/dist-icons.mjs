/**
 * One renderer for the sized icons, shared by the build and the test that pins
 * its bytes: ImageMagick, from the 800px opaque mark the site owns.
 *
 * The output must be a function of the mark's *bytes*, never of the checkout
 * it sits in. ImageMagick writes the build clock into `tIME` and
 * `date:timestamp`, and copies the *source file's* own dates into
 * `date:create`/`date:modify` — so a fresh clone, whose `public/mark-opaque.png`
 * has a new mtime, rendered four different icons from identical bytes. All four
 * are dropped here; the source's own `Software` tag stays.
 */

import { execFileSync } from 'node:child_process';

/**
 * The curve the mark's dark artwork is lifted by for the surfaces this page paints it on, which
 * are the landing page's own (`--card`, `--background`: both Mocha's dark grounds).
 *
 * The owner's export is a shaded wordmark whose glyph tones sit between `#2d111e` and `#7cc9c0`,
 * so on this page's ground the median ink pixel measured 1.70:1 and the mark read as a smudge
 * beside the name it belongs to. The site levelled its nav copy the same way and for the same
 * reason (`site/README.md`, "The site mark"): a gamma curve on the colour channels and nothing
 * else — no redraw, no recolour, the owner's own pixels on a lighter tone curve — applied
 * *after* the resize, which is the order both files are built in. `test/identity.test.ts`
 * measures the result over the ground it lands on, so a derivative that goes dark again fails.
 */
export const MARK_GAMMA = 2.4;

/**
 * Renders `source` at `size`×`size` into `out`.
 *
 * `gamma`, when given, is the levelling curve above, applied to the colour channels after the
 * resize and to nothing else.
 */
export function renderIcon(source, size, out, { gamma } = {}) {
  execFileSync(
    'magick',
    [
      source,
      '-resize',
      `${size}x${size}!`,
      ...(gamma === undefined ? [] : ['-channel', 'RGB', '-gamma', String(gamma), '+channel']),
      '-define',
      'png:exclude-chunk=time',
      '+set',
      'date:timestamp',
      '+set',
      'date:create',
      '+set',
      'date:modify',
      out,
    ],
    { stdio: 'inherit' },
  );
}
