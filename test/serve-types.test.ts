/**
 * The serving layer decides the Content-Type of every emitted extension — never
 * the host's mime.types. A hashed chunk answered as text/html blocks the module
 * load. This pins that the contract in scripts/check-content-types.mjs covers
 * everything dist/ emits.
 *
 * The types are pinned where they are decided: `content_type` in
 * `reference_server`'s `page.rs` has its own unit test, and the live check
 * (`npm run check:types`) asserts status and type for every dist/ file against
 * the deployed page. `selvaged` is the serving layer, so this file compares
 * against the one contract rather than a second copy.
 */
import { readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EXPECTED_TYPES } from '../scripts/check-content-types.mjs';

const DIST = new URL('../dist/', import.meta.url);

function distExtensions(): Set<string> {
  const exts = new Set<string>();
  for (const file of readdirSync(DIST)) {
    const at = file.lastIndexOf('.');
    if (at !== -1) exts.add(file.slice(at));
  }
  return exts;
}

describe('serve-types contract', () => {
  it('covers every extension dist/ emits', () => {
    let dist: string[];
    try {
      dist = [...distExtensions()];
    } catch {
      assert.fail('dist/ is missing — run npm run build first');
    }
    for (const ext of dist) {
      assert.ok(
        EXPECTED_TYPES[ext as keyof typeof EXPECTED_TYPES] !== undefined,
        `dist/ emits ${ext} but EXPECTED_TYPES has no entry — teach the serving layer first`,
      );
    }
  });
});
