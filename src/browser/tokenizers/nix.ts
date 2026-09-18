/**
 * A small Monarch set for Nix, which Monaco 0.52.2 does not ship. It covers the
 * room's own `flake.nix`: comments, the keywords, the common builtins, plain and
 * indented strings with `${}` interpolation, paths, numbers and the punctuation.
 * The loader is dynamic, so the body stays in a `lang-*.js` chunk and costs
 * nothing until a Nix document opens.
 */

export const conf = {
  comments: { lineComment: '#', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

export const language = {
  defaultToken: '',
  tokenPostfix: '.nix',
  keywords: ['let', 'in', 'with', 'if', 'then', 'else', 'assert', 'rec', 'inherit', 'or'],
  builtins: [
    'import',
    'derivation',
    'builtins',
    'abort',
    'throw',
    'map',
    'filter',
    'fetchTarball',
    'fetchurl',
    'fetchGit',
    'toString',
    'toFile',
    'readFile',
    'readDir',
    'attrNames',
    'attrValues',
    'mapAttrs',
    'concatStringsSep',
    'listToAttrs',
    'genList',
    'length',
    'elem',
    'head',
    'tail',
    'isNull',
    'isAttrs',
    'isList',
    'isString',
    'isInt',
    'isFloat',
    'isBool',
    'isFunction',
    'isPath',
    'typeOf',
    'baseNameOf',
    'dirOf',
    'removeAttrs',
    'getAttr',
    'hasAttr',
    'sort',
    'deepSeq',
    'seq',
    'trace',
    'warn',
  ],
  tokenizer: {
    root: [
      [/\s+/, 'white'],
      [/#.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"/, 'string', '@string'],
      [/''/, 'string', '@indented'],
      [/<[^>\n]*>/, 'string.path'],
      [/[a-zA-Z_][\w'-]*(?=\s*=)/, 'key'],
      [
        /[a-zA-Z_][\w'.-]*/,
        { cases: { '@keywords': 'keyword', '@builtins': 'predefined', '@default': 'identifier' } },
      ],
      [/-?\d+\.\d+/, 'number.float'],
      [/-?\d+/, 'number'],
      [/[{}[\]()]/, '@brackets'],
      [/[=;:.,?@]/, 'delimiter'],
      [/\$\{/, 'delimiter', '@interpolation'],
    ],
    interpolation: [
      [/\}/, 'delimiter', '@pop'],
      { include: '@root' },
    ],
    string: [
      [/\\./, 'string.escape'],
      [/\$\{/, 'delimiter', '@interpolation'],
      [/"/, 'string', '@pop'],
      [/[^\\"$]+/, 'string'],
      [/\$/, 'string'],
    ],
    indented: [
      [/\$\{/, 'delimiter', '@interpolation'],
      [/''/, 'string', '@pop'],
      [/[^'$]+/, 'string'],
      [/'/, 'string'],
    ],
    comment: [
      [/\*\//, 'comment', '@pop'],
      [/./, 'comment'],
    ],
  },
};
