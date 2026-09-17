/** Grant-tree file icons: one per backed type, plain file otherwise. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fileIcon } from '../src/browser/icons.ts';

describe('fileIcon', () => {
  it('names the backed types', () => {
    assert.equal(fileIcon('src/main.ts'), 'file-ts');
    assert.equal(fileIcon('src/app.tsx'), 'file-ts');
    assert.equal(fileIcon('lib/util.js'), 'file-js');
    assert.equal(fileIcon('lib/util.mjs'), 'file-js');
    assert.equal(fileIcon('notes.md'), 'file-md');
    assert.equal(fileIcon('docs/guide.markdown'), 'file-md');
    assert.equal(fileIcon('notes.txt'), 'file-txt');
  });

  it('leaves everything else a plain file', () => {
    assert.equal(fileIcon('src/main.rs'), 'file');
    assert.equal(fileIcon('Makefile'), 'file');
    assert.equal(fileIcon('no-extension'), 'file');
    assert.equal(fileIcon('.gitignore'), 'file');
  });

  it('matches case-insensitively', () => {
    assert.equal(fileIcon('NOTES.MD'), 'file-md');
    assert.equal(fileIcon('main.TS'), 'file-ts');
  });
});
