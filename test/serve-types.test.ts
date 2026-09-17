/**
 * S1 (2026-09-18): the serving layer decides the Content-Type of every
 * emitted extension — never the host's mime.types. A hashed chunk answered
 * as text/html blocks the module load. This pins that the contract in
 * scripts/check-content-types.mjs covers everything dist/ emits, and that the
 * canonical serve.py carries each entry with the exact type.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EXPECTED_TYPES } from '../scripts/check-content-types.mjs';

const DIST = new URL('../dist/', import.meta.url);
const SERVE_PY = new URL(
  '../../ai_notes/.tmp/web-hosting/serve.py',
  import.meta.url,
);

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

  it('the canonical serve.py carries each entry with the exact type', () => {
    let text: string;
    try {
      text = readFileSync(SERVE_PY, 'utf8');
    } catch {
      assert.fail('canonical serve.py is missing — it lives in ai_notes/.tmp/web-hosting/');
    }
    for (const [ext, mime] of Object.entries(EXPECTED_TYPES)) {
      assert.ok(
        text.includes(`'${ext}': '${mime}'`),
        `serve.py lacks '${ext}': '${mime}' — the Pi would serve it by platform guess`,
      );
    }
  });
});
