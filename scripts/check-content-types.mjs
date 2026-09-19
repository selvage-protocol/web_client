/**
 * Content-Type regression for the deployed page (S1, 2026-09-18): a
 * hashed chunk answered with text/html blocks the module load, so every
 * extension the bundler emits must serve its type — including a chunk the Pi
 * dist is missing (a stale sync answers 404 text/html, which fails here as a
 * non-200, exactly the owner symptom). Run after every deploy:
 *
 *   npm run check:types            # live Pi page (default)
 *   node scripts/check-content-types.mjs http://127.0.0.1:8081
 *
 * Every file in the local dist/ is checked, so a new emitted file or
 * extension is covered without editing this script — but the serving layer
 * must learn it too. The one origin (2026-09-19) made `selvaged` answer the
 * page itself, so the table to keep in step is `content_type` in
 * `reference_server/crates/selvaged/src/page.rs`, and a run against the
 * deployed page is what catches the two drifting apart.
 */
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The contract: extension served by the page, and the type it must carry. */
export const EXPECTED_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  // The manifest has a media type of its own and `page.rs` answers that one;
  // the one-origin move grouped it with JSON for a while, which is what this
  // line caught — a wrong type for a hashed chunk is what S1 was.
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
};

const DIST = new URL('../dist/', import.meta.url);

/**
 * Every file the local dist/ emits, with the type each must serve. All of
 * them — not one per extension: a stale Pi dist answers a missing hashed
 * chunk with 404 text/html while app.js still passes, so sampling one file
 * per extension would miss exactly the S1 window.
 */
export function distFiles() {
  const out = [];
  for (const file of readdirSync(DIST).map(String).sort()) {
    const at = file.lastIndexOf('.');
    const ext = at === -1 ? '' : file.slice(at);
    const want = EXPECTED_TYPES[ext];
    if (want === undefined) {
      throw new Error(`dist/${file} emits ${ext || '(no extension)'} — teach EXPECTED_TYPES and the serving layer's table first`);
    }
    out.push([ext, file, want]);
  }
  return out;
}

async function main() {
  const base = (process.argv[2] ?? 'https://lumi-raspberrypi.muskellunge-yo.ts.net:8444').replace(/\/$/, '');
  const reps = distFiles();
  if (reps.length === 0) {
    console.error('no dist/ files found — run npm run build first');
    process.exit(1);
  }
  let failures = 0;
  for (const [ext, file, want] of reps) {
    const url = `${base}/${file}`;
    let res;
    try {
      res = await fetch(url);
    } catch (error) {
      console.error(`FAIL ${ext} ${file}: fetch failed: ${error.message}`);
      failures += 1;
      continue;
    }
    await res.arrayBuffer().catch(() => {});
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (res.status !== 200) {
      console.error(`FAIL ${ext} ${file}: HTTP ${res.status} (stale dist serves the chunk URL as text/html)`);
      failures += 1;
    } else if (type !== want) {
      console.error(`FAIL ${ext} ${file}: Content-Type ${type || '(missing)'}, want ${want}`);
      failures += 1;
    } else {
      console.log(`ok ${ext} ${file}: ${type}`);
    }
  }
  console.log(failures === 0 ? `TYPES VERDICT: PASS (${reps.length} files)` : `TYPES VERDICT: FAIL (${failures}/${reps.length})`);
  process.exit(failures === 0 ? 0 : 1);
}

let invokedDirectly = false;
try {
  invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) {
  await main();
}
