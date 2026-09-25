/**
 * The card's mark: the renderer's own resample of the owner's export, and a curve that is applied
 * to the samples in JS.
 *
 * **The curve is the identity, and that is the point.** It was 2.4, lifting a mark whose shaded
 * glyph tones sit between `#2d111e` and `#7cc9c0` to a median ink of 4.9:1 on this page's ground:
 * the unlevelled render measures 1.72:1, under the 3:1 floor WCAG sets for a non-text mark beside
 * text. That floor does not apply here. `1.4.11` exempts logotypes — "text that is part of a logo
 * or brand name has no contrast requirement" — and this mark is the owner's own artwork, which is
 * worn unmodified everywhere it appears. Levelling it was a change to somebody else's drawing made
 * to satisfy a rule that exempts it.
 *
 * Nothing here is a redraw or a recolour either way: the curve is `pow(value, 1/gamma)` on the
 * colour channels, alpha untouched. At 1 it returns every sample as it arrived.
 *
 * The resample is this module's too, and for a reason CI found: the mark is an *alpha* image, and
 * resampling one — premultiply, average, unpremultiply — is not the same in every ImageMagick
 * release this page is built with. Trixie's 7.1.1 rendered different pixels from the 7.1.2 the
 * committed mark came from, red on the first two pushes of the branch that added it; the six sized
 * icons, which come from the *opaque* master, reproduce byte for byte in that image and always have.
 * So the whole mark is a function of the master's bytes and one arithmetic here: one area-weighted
 * average in premultiplied space, one curve, one encoder.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

/**
 * The curve the mark's colour channels are put through: the identity, so the mark the page paints
 * is the mark the owner exported. See the module note for why the 2.4 it used to be was the wrong
 * answer to the wrong rule.
 */
export const MARK_GAMMA = 1.0;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
 * Everything happens here: the master's own bytes are decoded, area-averaged down, levelled and
 * written back, so the mark is a function of the artwork and one arithmetic rather than of the
 * ImageMagick release that happens to be installed.
 */
export function renderLevelledMark(source, size, out, gamma = MARK_GAMMA) {
  const master = decodePng(readFileSync(source));
  const resampled = resamplePremultiplied(master, size);
  writeFileSync(out, encodePng(levelRaster(resampled, gamma), size, size));
}

/**
 * The master at `size`×`size`, each pixel the area-weighted average of the master it covers.
 *
 * Premultiplied by alpha before the average and unpremultiplied after, which is the only way an
 * alpha image resamples: the artwork's transparent field carries no colour, and averaging its bare
 * RGB into the glyph edges would darken them with whatever happens to be behind it in the file.
 * The weights are exact — the overlap of each source pixel with the destination pixel's box — so
 * no filter constant is chosen here and no ringing is introduced; the mark is a wordmark at about
 * an eighth of its size, which is what averaging is for.
 */
export function resamplePremultiplied(png, size) {
  const { width, height, channels, raster } = png;
  if (channels !== 4) {
    throw new Error(`the master is not an alpha image (${channels} channels)`);
  }
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const top = (y * height) / size;
    const bottom = ((y + 1) * height) / size;
    for (let x = 0; x < size; x += 1) {
      const left = (x * width) / size;
      const right = ((x + 1) * width) / size;
      const acc = [0, 0, 0, 0];
      let weight = 0;
      for (let source = Math.floor(top); source < Math.ceil(bottom); source += 1) {
        const across = Math.min(source + 1, bottom) - Math.max(source, top);
        for (let column = Math.floor(left); column < Math.ceil(right); column += 1) {
          const down = Math.min(column + 1, right) - Math.max(column, left);
          const share = across * down;
          const at = (source * width + column) * 4;
          const alpha = raster[at + 3];
          acc[0] += raster[at] * alpha * share;
          acc[1] += raster[at + 1] * alpha * share;
          acc[2] += raster[at + 2] * alpha * share;
          acc[3] += alpha * share;
          weight += share;
        }
      }
      const at = (y * size + x) * 4;
      out[at + 3] = Math.round(acc[3] / weight);
      for (let channel = 0; channel < 3; channel += 1) {
        out[at + channel] = acc[3] < 1 ? 0 : Math.round(acc[channel] / acc[3]);
      }
    }
  }
  return out;
}

/**
 * An 8-bit RGBA PNG of those pixels: the one encoder the inlined mark is written with.
 *
 * Every row is stored unfiltered (filter 0) and the whole raster deflates in one `IDAT`, which is
 * the simplest thing zlib and a PNG reader both accept. The bytes are a function of the pixels and
 * of the zlib in this runtime; what the identity test compares is the *pixels* on both sides, so an
 * encoder that compresses differently is not a difference in the mark.
 */
export function encodePng(raster, width, height) {
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    filtered[row * (stride + 1)] = 0;
    raster.copy(filtered, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  return Buffer.concat([
    PNG_MAGIC,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** One PNG chunk: its length, its type, its body and their CRC. */
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** The CRC-32 a PNG chunk carries, from its own table. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let at = 0; at < 256; at += 1) {
    let value = at;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[at] = value >>> 0;
  }
  return table;
})();

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
