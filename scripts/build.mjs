/**
 * Bundles the page: the script (code-split, so language tokenizers load only when
 * a document of that language opens), its stylesheet, and the two Monaco workers
 * the page's modes need — the editor fallback and the TypeScript/JavaScript
 * language worker. The `ws` package is a dev-only proof dependency; the tsconfig
 * maps it to a throwing stub, so a bundle mentioning it fails here rather than
 * in a browser.
 */

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Fresh dist every build (S1, 2026-09-18): chunk names carry content hashes,
// so an incremental dist accumulates orphaned bundles — still served, still
// scanned, and never referenced. Everything below is generated (bundles,
// rendered icons, written manifest, copied shell), so the directory is
// rebuilt wholesale.
rmSync(resolve(root, 'dist'), { recursive: true, force: true });
mkdirSync(resolve(root, 'dist'), { recursive: true });

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  // Minified (S3, 2026-09-18): the served bytes carry no library doc
  // comments — including their `file://` URI samples, which a served-page
  // scan cannot tell apart from real references. Only runtime-code literals
  // remain (see test/links.test.ts), each audited there.
  minify: true,
  loader: { '.css': 'css', '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
  inject: [resolve(root, 'src/browser/node-shim.ts')],
  logLevel: 'info',
};

const app = await build({
  ...shared,
  entryPoints: [resolve(root, 'src/browser/main.ts')],
  outdir: resolve(root, 'dist'),
  entryNames: 'app',
  chunkNames: 'lang-[hash]',
  format: 'esm',
  splitting: true,
  metafile: true,
  // No sourcesContent (S3, 2026-09-18): maps carry names and mappings only,
  // never the original sources with their own `file://` doc samples.
  sourcemap: true,
  sourcesContent: false,
});

for (const [entry, outfile] of [
  ['src/browser/workers/editor.worker.ts', 'dist/editor.worker.js'],
  ['src/browser/workers/ts.worker.ts', 'dist/ts.worker.js'],
]) {
  await build({
    ...shared,
    entryPoints: [resolve(root, entry)],
    outfile: resolve(root, outfile),
    format: 'iife',
    sourcemap: false,
  });
}

const inputs = Object.keys(app.metafile?.inputs ?? {});
const leaked = inputs.filter((input) => /(^|\/)ws\//.test(input) || input.endsWith('/ws.js'));
if (leaked.length > 0) {
  console.error(`refusing bundle: ws package inputs present: ${leaked.join(', ')}`);
  process.exit(1);
}
if (!inputs.some((input) => input.includes('monaco-editor'))) {
  console.error('refusing bundle: monaco-editor is not in the bundle');
  process.exit(1);
}

cpSync(resolve(root, 'public/index.html'), resolve(root, 'dist/index.html'));
// Identity: the owner's mark, byte-identical from the site. Sized favicon and
// touch icons are rendered here, at build time, from the 800px opaque mark —
// no hand-scaled binaries live in the source tree.
for (const asset of ['favicon.svg', 'mark-opaque.png', 'mark-transparent.png']) {
  cpSync(resolve(root, 'public', asset), resolve(root, 'dist', asset));
}
for (const [size, out] of [
  [32, 'favicon-32x32.png'],
  [180, 'apple-touch-icon.png'],
  [192, 'icon-192.png'],
  [512, 'icon-512.png'],
]) {
  execFileSync(
    'magick',
    [resolve(root, 'public/mark-opaque.png'), '-resize', `${size}x${size}!`, resolve(root, `dist/${out}`)],
    { stdio: 'inherit' },
  );
}
writeFileSync(
  resolve(root, 'dist/site.webmanifest'),
  JSON.stringify(
    {
      name: 'Selvage — shared editing in the browser',
      short_name: 'Selvage',
      display: 'standalone',
      background_color: '#1e1e2e',
      theme_color: '#1e1e2e',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2,
  ) + '\n',
);
// A stale placeholder worker from the scaffold must not linger beside the real ones.
rmSync(resolve(root, 'dist/monaco-worker.js'), { force: true });
console.log('dist/ ready: serve it, e.g. npm run serve');
