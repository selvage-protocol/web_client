/**
 * Prints the shell's inlined mark: a 104 px render of the mark the site owns,
 * levelled the way the site levels its own nav copy (`scripts/mark-level.mjs`),
 * as the `data:image/png;base64,…` URI `public/index.html` carries in its
 * `.mark` rule. 104 px is the card's 3.25rem at 2x, the largest the mark is ever
 * shown, and the renderer is the one the build's icons use — so a refresh is
 * one paste, never a redraw.
 *
 * Run it after the site's `public/mark-transparent.png` changes (the identity
 * test fails until the URI matches, and says so):
 *
 *   node scripts/inline-mark.mjs
 *
 * The bytes are a function of the source file alone: the clocks ImageMagick
 * would stamp into `tIME` and `date:*` are dropped, as they are for the icons.
 */

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderLevelledMark } from './mark-level.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const size = 104;
// Scratch stays in the checkout: `.tmp/` is ignored and never shared.
const scratch = resolve(root, '.tmp/inline-mark');
mkdirSync(scratch, { recursive: true });
try {
  const out = resolve(scratch, `mark-${size}.png`);
  renderLevelledMark(resolve(root, 'public/mark-transparent.png'), size, out);
  console.log(`data:image/png;base64,${readFileSync(out).toString('base64')}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
