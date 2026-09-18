/** The room path's language: every backed mode is named, the rest is plaintext. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { languageForPath } from '../src/browser/languages.ts';

describe('languageForPath', () => {
  it('names the modes the bundle has always backed', () => {
    assert.equal(languageForPath('notes.md'), 'markdown');
    assert.equal(languageForPath('docs/guide.markdown'), 'markdown');
    assert.equal(languageForPath('src/main.ts'), 'typescript');
    assert.equal(languageForPath('src/app.tsx'), 'typescript');
    assert.equal(languageForPath('lib/util.js'), 'javascript');
    assert.equal(languageForPath('lib/util.mjs'), 'javascript');
  });

  it('names the project types a room plausibly holds', () => {
    assert.equal(languageForPath('reference_server/src/main.rs'), 'rust');
    assert.equal(languageForPath('public/site.css'), 'css');
    assert.equal(languageForPath('styles/theme.scss'), 'scss');
    assert.equal(languageForPath('styles/theme.less'), 'less');
    assert.equal(languageForPath('package.json'), 'json');
    assert.equal(languageForPath('tsconfig.jsonc'), 'json');
    assert.equal(languageForPath('index.html'), 'html');
    assert.equal(languageForPath('icon.svg'), 'xml');
    assert.equal(languageForPath('flake.nix'), 'nix');
    assert.equal(languageForPath('scripts/run.sh'), 'shell');
    assert.equal(languageForPath('Cargo.toml'), 'toml');
    assert.equal(languageForPath('config.yml'), 'yaml');
    assert.equal(languageForPath('tool.py'), 'python');
    assert.equal(languageForPath('cmd/main.go'), 'go');
    assert.equal(languageForPath('src/vector.c'), 'cpp');
    assert.equal(languageForPath('src/vector.cpp'), 'cpp');
    assert.equal(languageForPath('src/vector.h'), 'cpp');
    assert.equal(languageForPath('App.java'), 'java');
    assert.equal(languageForPath('schema.sql'), 'sql');
    assert.equal(languageForPath('plugin.lua'), 'lua');
    assert.equal(languageForPath('app.ini'), 'ini');
    assert.equal(languageForPath('Dockerfile'), 'dockerfile');
    assert.equal(languageForPath('.editorconfig'), 'ini');
  });

  it('leaves an unbacked type plaintext', () => {
    assert.equal(languageForPath('todo.txt'), 'plaintext');
    assert.equal(languageForPath('Makefile'), 'plaintext');
    assert.equal(languageForPath('.gitignore'), 'plaintext');
    assert.equal(languageForPath('no-extension'), 'plaintext');
    assert.equal(languageForPath('trailing.'), 'plaintext');
  });

  it('matches extensions case-insensitively', () => {
    assert.equal(languageForPath('NOTES.MD'), 'markdown');
    assert.equal(languageForPath('main.TS'), 'typescript');
    assert.equal(languageForPath('cargo.TOML'), 'toml');
  });
});
