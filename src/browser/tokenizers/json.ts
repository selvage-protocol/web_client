/**
 * A small Monarch set for JSON, which Monaco 0.52.2 does not ship as a basic
 * language: its JSON support is the schema-aware language service, whose worker
 * this page does not carry. This covers the room's own `package.json` and
 * friends — colour, not validation. The loader is dynamic, so the body stays in
 * a `lang-*.js` chunk and costs nothing until a JSON document opens.
 */

export const conf = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
};

export const language = {
  defaultToken: '',
  tokenPostfix: '.json',
  tokenizer: {
    root: [
      [/\s+/, 'white'],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'key'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/[{}[\]]/, '@brackets'],
      [/[,:]/, 'delimiter'],
    ],
    comment: [
      [/[^*/]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[*/]/, 'comment'],
    ],
  },
};
