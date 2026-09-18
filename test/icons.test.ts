/** Grant-tree file icons: one readable, colour-coded icon per backed type. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fileIcon, iconSvg } from '../src/browser/icons.ts';

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

  it('names the project types a room plausibly holds', () => {
    assert.equal(fileIcon('src/engine.ts'), 'file-ts');
    assert.equal(fileIcon('reference_server/src/main.rs'), 'file-rs');
    assert.equal(fileIcon('public/site.css'), 'file-css');
    assert.equal(fileIcon('styles/theme.scss'), 'file-scss');
    assert.equal(fileIcon('page.json'), 'file-json');
    assert.equal(fileIcon('index.html'), 'file-html');
    assert.equal(fileIcon('icon.svg'), 'file-xml');
    assert.equal(fileIcon('scripts/run.sh'), 'file-sh');
    assert.equal(fileIcon('Cargo.toml'), 'file-toml');
    assert.equal(fileIcon('flake.nix'), 'file-nix');
    assert.equal(fileIcon('config.yml'), 'file-yaml');
    assert.equal(fileIcon('.editorconfig'), 'file-ini');
    assert.equal(fileIcon('tool.py'), 'file-py');
    assert.equal(fileIcon('cmd/main.go'), 'file-go');
    assert.equal(fileIcon('src/vector.c'), 'file-c');
    assert.equal(fileIcon('src/vector.cpp'), 'file-cpp');
    assert.equal(fileIcon('src/vector.h'), 'file-h');
    assert.equal(fileIcon('App.java'), 'file-java');
    assert.equal(fileIcon('schema.sql'), 'file-sql');
    assert.equal(fileIcon('plugin.lua'), 'file-lua');
    assert.equal(fileIcon('Dockerfile'), 'file-docker');
  });

  it('leaves an unbacked type a plain file', () => {
    assert.equal(fileIcon('Makefile'), 'file');
    assert.equal(fileIcon('no-extension'), 'file');
    assert.equal(fileIcon('.gitignore'), 'file');
    assert.equal(fileIcon('trailing.'), 'file');
  });

  it('matches case-insensitively', () => {
    assert.equal(fileIcon('NOTES.MD'), 'file-md');
    assert.equal(fileIcon('main.TS'), 'file-ts');
    assert.equal(fileIcon('cargo.TOML'), 'file-toml');
  });
});

describe('typed file icons', () => {
  it('draws a page in the type colour with a label, not a bare outline', () => {
    const ts = iconSvg('file-ts');
    assert.ok(ts.includes('fill="#3178c6"'), `no TypeScript page colour: ${ts}`);
    assert.ok(/<text[^>]*font-size="7\.6"/.test(ts), `no readable label: ${ts}`);
    const rs = iconSvg('file-rs');
    assert.ok(rs.includes('fill="#f74c00"'), `no Rust page colour: ${rs}`);
    assert.ok(/>RS</.test(rs), `no Rust label: ${rs}`);
  });

  it('escapes angle brackets so an HTML label cannot break the markup', () => {
    const html = iconSvg('file-html');
    assert.ok(html.includes('&lt;&gt;'), `angle-bracket label not escaped: ${html}`);
    assert.ok(!html.includes('><>'), `raw angle bracket in label: ${html}`);
  });

  it('keeps the generic and text files the muted outline', () => {
    assert.ok(iconSvg('file').includes('stroke="currentColor"'));
    assert.ok(iconSvg('file-txt').includes('stroke="currentColor"'));
    assert.ok(!iconSvg('file-txt').includes('<text'));
  });
});
