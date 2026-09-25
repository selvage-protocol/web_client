/**
 * The card's mark: the renderer's own resample, and the levelling applied to the samples in JS.
 *
 * The owner's export is a shaded wordmark whose glyph tones sit between `#2d111e` and `#7cc9c0`,
 * so on this page's dark grounds the median ink pixel measured 1.7:1 and the monogram read as a
 * smudge beside the name it belongs to. The site levelled its own nav copy with ImageMagick's
 * `-gamma 2.4` for the same reason (`site/README.md`, "The site mark"); here the curve is applied
 * to the decode of every pixel, in one arithmetic, because `-gamma` is *not* the same curve in every
 * ImageMagick release this page is built with — trixie's 7.1.1 renders it differ from the 7.1.2 the
 * committed bytes came from, which is a red CI (`test/identity.test.ts`) rather than a difference
 * anyone chose. The resample stays ImageMagick's: it is the renderer the sized icons go through, and
 * its output is what CI holds byte for byte.
 *
 * Nothing here is a redraw or a recolour: the curve is `pow(value, 1/gamma)` on the colour channels,
 * alpha untouched, which is what the site's derivative does and nothing more.
 */

import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

/** The curve the mark is levelled by. `1.7:1` on this page's ground becomes `4.9:1`. */
export const MARK_GAMMA = 2.4;

/** The pixels of an 8-bit RGBA raster, as `channels`-interleaved bytes. */
export function levelRaster(raster, gamma = MARK_GAMMA) {
  const out = Buffer.from(raster);
  // The curve is a table over the 256 possible samples, so every pixel takes the same arithmetic
  // and the result is a function of the byte rather than of the floating-point path to it.
  const table = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    table[value] = Math.round(255 * Math.pow(value / 255, 1 / gamma));
  }
  for (let at = 0; at + 3 < out.length; at += 4) {
    out[at] = table[out[at]];
    out[at + 1] = table[out[at + 1]];
    out[at + 2] = table[out[at + 2]];
  }
  return out;
}

/**
 * Renders `source` at `size`×`size`, levelled, as a PNG at `out`.
 *
 * The resample and the encoder are ImageMagick's, with the clocks dropped (a fresh clone's mark has
 * a new mtime, and the build's icons taught that lesson); the curve between them is this module's.
 */
export function renderLevelledMark(source, size, out, gamma = MARK_GAMMA) {
  const raster = execFileSync('magick', [source, '-resize', `${size}x${size}!`, '-depth', '8', 'rgba:-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync(
    'magick',
    [
      '-size',
      `${size}x${size}`,
      '-depth',
      '8',
      'rgba:-',
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
    { input: levelRaster(raster, gamma), stdio: ['pipe', 'inherit', 'inherit'] },
  );
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * An 8-bit RGB or RGBA PNG as `{ width, height, raster }`, or a throw.
 *
 * The page owns one PNG it did not write with this module's own encoder — the inlined mark, which
 * is a paste of what the encoder wrote — and reading it back is what the identity test compares
 * and measures. The two shapes ImageMagick writes for this artwork are the ones accepted; any
 * other (16-bit, paletted, interlaced) is refused rather than guessed at.
 */
export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error('not a PNG');
  }
  let header;
  const compressed = [];
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') header = body;
    else if (kind === 'IDAT') compressed.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }
  if (header === undefined || header.length < 13) {
    throw new Error('no IHDR');
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header.readUInt8(8);
  const colour = header.readUInt8(9);
  const interlace = header.readUInt8(12);
  if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${depth}, colour ${colour}, interlace ${interlace}`);
  }
  const channels = colour === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  if (raw.length !== height * (stride + 1)) {
    throw new Error('the raster is not the size its header declares');
  }
  const raster = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  for (let row = 0, at = 0; row < height; row += 1) {
    const filter = raw[at];
    at += 1;
    const line = Buffer.from(raw.subarray(at, at + stride));
    at += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = previous[i];
      const corner = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + left) & 0xff;
      else if (filter === 2) line[i] = (line[i] + up) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const da = Math.abs(estimate - left);
        const db = Math.abs(estimate - up);
        const dc = Math.abs(estimate - corner);
        const predictor = da <= db && da <= dc ? left : db <= dc ? up : corner;
        line[i] = (line[i] + predictor) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`filter ${filter} on row ${row}`);
      }
    }
    line.copy(raster, row * stride);
    previous = line;
  }
  return { width, height, channels, raster };
}
