/**
 * The page's own Monarch sets — JSON, TOML and Nix — driven through the real
 * lexer. `test/languages.test.ts` maps a room path to a language id; nothing
 * tokenized the sets those ids load, so a set that threw on its first
 * assignment line still passed every test (B1, 2026-09-18: `Cargo.toml` lost
 * its colour and raised an uncaught page error on every pass).
 *
 * The path here is Monaco's own: `compile()` the language definition, then
 * `MonarchTokenizer` over the lines. That is the whole point of the shape —
 * Monaco's `registerLanguage` hands the tokenizer the *language definition*
 * alone (`_.contribution.js`), so the `brackets` in `conf` never reach it, and
 * a `@brackets` character with no pair in the definition throws on the line
 * that carries it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { compile } from 'monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js';
import { MonarchTokenizer } from 'monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js';

import { language as jsonLanguage } from '../src/browser/tokenizers/json.ts';
import { language as nixLanguage } from '../src/browser/tokenizers/nix.ts';
import { language as tomlLanguage } from '../src/browser/tokenizers/toml.ts';

/** The two services `MonarchTokenizer` reads: nothing here needs a DOM. */
const languageService = {
  isRegisteredLanguageId: () => false,
  getLanguageIdByLanguageName: () => null,
  getLanguageIdByMimeType: () => null,
  languageIdCodec: { encodeLanguageId: () => 0 },
};
const configuration = {
  getValue: () => 20_000,
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};
const theme = { getColorTheme: () => ({ tokenTheme: {} }) };

/** One token as the test reads it: the text it covers, and its class. */
type Piece = [text: string, type: string];

/**
 * Tokenizes a document the way Monaco does: each line through the lexer, the
 * end state carried into the next, so a state opened on one line (a multi-line
 * string) is still open on the one after it.
 */
function tokenize(languageId: string, language: unknown, source: string): Piece[][] {
  const lexer = compile(languageId, language);
  const tokenizer = new MonarchTokenizer(
    languageService as never,
    theme as never,
    languageId,
    lexer as never,
    configuration as never,
  );
  const lines = source.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  let state = tokenizer.getInitialState();
  return lines.map((line, at) => {
    const hasEOL = at < lines.length - 1 || source.endsWith('\n');
    const result = tokenizer.tokenize(line, hasEOL, state);
    state = result.endState;
    return result.tokens.map((token, index) => [
      line.slice(token.offset, result.tokens[index + 1]?.offset ?? line.length),
      token.type,
    ]);
  });
}

/** The pieces of one line. */
function line(pieces: Piece[][], at: number): Piece[] {
  const found = pieces[at];
  assert.ok(found !== undefined, `the document has no line ${at}`);
  return found;
}

/** Every class the document emitted, for the "it still has colour" assertions. */
function classes(pieces: Piece[][]): Set<string> {
  return new Set(pieces.flat().map(([, type]) => type));
}

const CARGO_TOML = `[package]
name = "selvage"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
lib0 = "0.2"
keywords = [
  "one",
  "two",
]

[profile.release]
description = """
line one
line two
"""
truthy = true
count = 1_000
released = 2026-09-18
`;

describe('the TOML set, over a Cargo.toml', () => {
  it('tokenizes every line, assignment and inline table alike', () => {
    const pieces = tokenize('toml', tomlLanguage, CARGO_TOML);
    assert.equal(pieces.length, 21, 'the document lost lines');
    for (const [at, found] of pieces.entries()) {
      assert.ok(
        found.every(([, type]) => type !== undefined),
        `line ${at} tokenized into nothing`,
      );
    }
  });

  it('reads the table header, the key, the delimiter and the value', () => {
    const pieces = tokenize('toml', tomlLanguage, CARGO_TOML);
    assert.deepEqual(line(pieces, 0), [['[package]', 'type.toml']]);
    assert.deepEqual(line(pieces, 1), [
      ['name ', 'key.toml'],
      ['=', 'delimiter.toml'],
      [' ', ''],
      ['"selvage"', 'string.toml'],
    ]);
    assert.deepEqual(line(pieces, 2), [
      ['version ', 'key.toml'],
      ['=', 'delimiter.toml'],
      [' ', ''],
      ['"0.1.0"', 'string.toml'],
    ]);
  });

  it('keeps an inline table apart from an array', () => {
    const pieces = tokenize('toml', tomlLanguage, CARGO_TOML);
    const classes = line(pieces, 6).map(([, type]) => type);
    assert.ok(classes.includes('delimiter.curly.toml'), 'the inline table lost its braces');
    assert.ok(classes.includes('delimiter.square.toml'), 'the array lost its brackets');
    assert.ok(classes.includes('delimiter.toml'), 'the table lost its commas and equals');
    assert.ok(classes.includes('string.toml'), 'the inline table lost its strings');
  });

  it('carries the multi-line string across lines', () => {
    const pieces = tokenize('toml', tomlLanguage, CARGO_TOML);
    assert.deepEqual(line(pieces, 14), [
      ['description ', 'key.toml'],
      ['=', 'delimiter.toml'],
      [' ', ''],
      ['"""', 'string.toml'],
    ]);
    assert.deepEqual(line(pieces, 15), [['line one', 'string.toml']]);
    assert.deepEqual(line(pieces, 16), [['line two', 'string.toml']]);
    assert.deepEqual(line(pieces, 17), [['"""', 'string.toml']]);
    // Closed again: the next line is ordinary TOML, not more string.
    assert.deepEqual(line(pieces, 18), [
      ['truthy ', 'key.toml'],
      ['=', 'delimiter.toml'],
      [' ', ''],
      ['true', 'keyword.toml'],
    ]);
    assert.deepEqual(line(pieces, 19), [
      ['count ', 'key.toml'],
      ['=', 'delimiter.toml'],
      [' ', ''],
      ['1_000', 'number.toml'],
    ]);
    assert.deepEqual(line(pieces, 20), [
      ['released ', 'key.toml'],
      ['=', 'delimiter.toml'],
      [' ', ''],
      ['2026-09-18', 'number.date.toml'],
    ]);
  });

  it('reads a dotted key as one key', () => {
    const pieces = tokenize('toml', tomlLanguage, 'profile.release.lto = true\n');
    assert.deepEqual(line(pieces, 0), [
      ['profile.release.lto ', 'key.toml'],
      ['=', 'delimiter.toml'],
      [' ', ''],
      ['true', 'keyword.toml'],
    ]);
  });
});

describe('the JSON set, over a package.json', () => {
  const PACKAGE_JSON = `{
  "name": "selvage",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "node scripts/build.mjs"
  },
  "keywords": ["selvage", "monaco"],
  "count": 3,
  "nothing": null
}
`;

  it('tokenizes every line without throwing', () => {
    const pieces = tokenize('json', jsonLanguage, PACKAGE_JSON);
    assert.equal(pieces.length, 11, 'the document lost lines');
  });

  it('reads keys apart from string values, and the three literals', () => {
    const pieces = tokenize('json', jsonLanguage, PACKAGE_JSON);
    assert.deepEqual(line(pieces, 1), [
      ['  ', 'white.json'],
      ['"name"', 'key.json'],
      [':', 'delimiter.json'],
      [' ', 'white.json'],
      ['"selvage"', 'string.json'],
      [',', 'delimiter.json'],
    ]);
    assert.deepEqual(line(pieces, 3), [
      ['  ', 'white.json'],
      ['"private"', 'key.json'],
      [':', 'delimiter.json'],
      [' ', 'white.json'],
      ['true', 'keyword.json'],
      [',', 'delimiter.json'],
    ]);
    const everything = classes(pieces);
    for (const type of [
      'delimiter.curly.json',
      'delimiter.square.json',
      'number.json',
      'string.json',
      'keyword.json',
    ]) {
      assert.ok(everything.has(type), `the package.json lost ${type}`);
    }
    assert.ok(everything.has('number.json'), 'the count lost its colour');
    assert.ok(line(pieces, 9).some(([text, type]) => text === 'null' && type === 'keyword.json'));
  });
});

describe('the Nix set, over a flake.nix', () => {
  const FLAKE_NIX = `{ pkgs, ... }:

let
  # a comment
  inherit (pkgs) lib;
  version = "0.1.0";
  mkVm = name: ''
    ssh \${name} host
  '';
in
{
  buildInputs = with pkgs; [ cargo rustc ];
  flag = true;
  ratio = 1.5;
  home = builtins.getEnv "HOME";
}
`;

  it('tokenizes every line without throwing', () => {
    const pieces = tokenize('nix', nixLanguage, FLAKE_NIX);
    assert.equal(pieces.length, 16, 'the document lost lines');
  });

  it('reads keywords, keys and the punctuation apart', () => {
    const pieces = tokenize('nix', nixLanguage, FLAKE_NIX);
    assert.deepEqual(line(pieces, 0), [
      ['{', 'delimiter.curly.nix'],
      [' ', 'white.nix'],
      ['pkgs', 'identifier.nix'],
      [',', 'delimiter.nix'],
      [' ', 'white.nix'],
      ['...', 'delimiter.nix'],
      [' ', 'white.nix'],
      ['}', 'delimiter.curly.nix'],
      [':', 'delimiter.nix'],
    ]);
    assert.deepEqual(line(pieces, 2), [['let', 'keyword.nix']]);
    assert.deepEqual(line(pieces, 3), [
      ['  ', 'white.nix'],
      ['# a comment', 'comment.nix'],
    ]);
    assert.deepEqual(line(pieces, 5), [
      ['  ', 'white.nix'],
      ['version', 'key.nix'],
      [' ', 'white.nix'],
      ['=', 'delimiter.nix'],
      [' ', 'white.nix'],
      ['"0.1.0"', 'string.nix'],
      [';', 'delimiter.nix'],
    ]);
  });

  it('carries the indented string and its interpolation across lines', () => {
    const pieces = tokenize('nix', nixLanguage, FLAKE_NIX);
    assert.deepEqual(line(pieces, 6), [
      ['  ', 'white.nix'],
      ['mkVm', 'key.nix'],
      [' ', 'white.nix'],
      ['=', 'delimiter.nix'],
      [' ', 'white.nix'],
      ['name', 'identifier.nix'],
      [':', 'delimiter.nix'],
      [' ', 'white.nix'],
      ["''", 'string.nix'],
    ]);
    assert.deepEqual(line(pieces, 7), [
      ['    ssh ', 'string.nix'],
      ['${', 'delimiter.nix'],
      ['name', 'identifier.nix'],
      ['}', 'delimiter.nix'],
      [' host', 'string.nix'],
    ]);
    assert.deepEqual(line(pieces, 8), [
      ["  ''", 'string.nix'],
      [';', 'delimiter.nix'],
    ]);
    // Closed again: the `in` below is a keyword, not string.
    assert.deepEqual(line(pieces, 9), [['in', 'keyword.nix']]);
  });

  it('keeps the builtins and the numbers coloured', () => {
    const pieces = tokenize('nix', nixLanguage, FLAKE_NIX);
    assert.deepEqual(line(pieces, 13), [
      ['  ', 'white.nix'],
      ['ratio', 'key.nix'],
      [' ', 'white.nix'],
      ['=', 'delimiter.nix'],
      [' ', 'white.nix'],
      ['1.5', 'number.float.nix'],
      [';', 'delimiter.nix'],
    ]);
    assert.deepEqual(line(pieces, 14), [
      ['  ', 'white.nix'],
      ['home', 'key.nix'],
      [' ', 'white.nix'],
      ['=', 'delimiter.nix'],
      [' ', 'white.nix'],
      ['builtins.getEnv', 'identifier.nix'],
      [' ', 'white.nix'],
      ['"HOME"', 'string.nix'],
      [';', 'delimiter.nix'],
    ]);
    // A bare builtin reads as one. A dotted one does not: the identifier rule
    // swallows `builtins.getEnv` whole, which is cosmetic and unchanged here.
    assert.deepEqual(line(tokenize('nix', nixLanguage, 'count = length items;\n'), 0), [
      ['count', 'key.nix'],
      [' ', 'white.nix'],
      ['=', 'delimiter.nix'],
      [' ', 'white.nix'],
      ['length', 'predefined.nix'],
      [' ', 'white.nix'],
      ['items', 'identifier.nix'],
      [';', 'delimiter.nix'],
    ]);
  });
});
