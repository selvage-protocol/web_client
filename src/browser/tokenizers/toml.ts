/**
 * A small Monarch set for TOML, which Monaco 0.52.2 does not ship. It covers
 * the room's own `Cargo.toml`: comments, table headers, keys, the four string
 * forms, numbers and dates. The loader is dynamic, so the body stays in a
 * `lang-*.js` chunk and costs nothing until a TOML document opens.
 */

export const conf = {
  comments: { lineComment: '#' },
  brackets: [
    ['[', ']'],
    ['{', '}'],
  ],
  autoClosingPairs: [
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

export const language = {
  defaultToken: '',
  tokenPostfix: '.toml',
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/^\s*\[\[?[^\]]*\]\]?/, 'type'],
      [/^\s*[\w.-]+\s*(?==)/, 'key'],
      [/"""/, 'string', '@multiline'],
      [/'''/, 'string', '@multiliteral'],
      [/"/, 'string', '@string'],
      [/'/, 'string', '@literal'],
      [/\b(?:true|false)\b/, 'keyword'],
      [
        /\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/,
        'number.date',
      ],
      [/[+-]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/, 'number'],
      // The brackets this language declares in `conf` — and nothing else:
      // Monarch compiles the tokenizer from the language definition alone, so
      // a character here with no pair there throws on the line that carries
      // it. The assignment operators are punctuation, not brackets.
      [/[{}[\]]/, '@brackets'],
      [/[.,=]/, 'delimiter'],
    ],
    string: [
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
      [/[^\\"]+/, 'string'],
    ],
    literal: [
      [/'/, 'string', '@pop'],
      [/[^']+/, 'string'],
    ],
    multiline: [
      [/"""/, 'string', '@pop'],
      [/\\./, 'string.escape'],
      [/[^\\"]+/, 'string'],
      [/"/, 'string'],
    ],
    multiliteral: [
      [/'''/, 'string', '@pop'],
      [/[^']+/, 'string'],
      [/'/, 'string'],
    ],
  },
};
