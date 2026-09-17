/** The room path's language: only backed modes are named, the rest is plaintext. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { languageForPath } from '../src/browser/languages.ts';

describe('languageForPath', () => {
  it('names the backed modes by extension', () => {
    assert.equal(languageForPath('notes.md'), 'markdown');
    assert.equal(languageForPath('docs/guide.markdown'), 'markdown');
    assert.equal(languageForPath('src/main.ts'), 'typescript');
    assert.equal(languageForPath('src/app.tsx'), 'typescript');
    assert.equal(languageForPath('lib/util.js'), 'javascript');
    assert.equal(languageForPath('lib/util.mjs'), 'javascript');
  });

  it('leaves everything else plaintext', () => {
    assert.equal(languageForPath('notes.txt'), 'plaintext');
    assert.equal(languageForPath('src/main.rs'), 'plaintext');
    assert.equal(languageForPath('Makefile'), 'plaintext');
    assert.equal(languageForPath('.gitignore'), 'plaintext');
    assert.equal(languageForPath('no-extension'), 'plaintext');
    assert.equal(languageForPath('trailing.'), 'plaintext');
  });

  it('matches extensions case-insensitively', () => {
    assert.equal(languageForPath('NOTES.MD'), 'markdown');
    assert.equal(languageForPath('main.TS'), 'typescript');
  });
});
