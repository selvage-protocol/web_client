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
 *
 * The card's own mark does not come through here: it is an alpha image, and
 * resampling one is not the same in every ImageMagick release this page is
 * built with. `scripts/mark-level.mjs` owns that whole derivation.
 */

import { execFileSync } from 'node:child_process';

/** Renders `source` at `size`×`size` into `out`. */
export function renderIcon(source, size, out) {
  execFileSync(
    'magick',
    [
      source,
      '-resize',
      `${size}x${size}!`,
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
