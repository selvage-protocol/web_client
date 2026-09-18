/**
 * Peer-presence visibility: initials badges, one badge per line, and the
 * Monaco rendering (glyph-margin badge, caret bar, labelled hover). The whole-
 * line marker is deliberately absent — a peer is a caret bar and, when they
 * hold a selection, a fill.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding, literalMarkdown } from '../src/browser/editor.ts';
import {
  ANONYMOUS_INITIALS,
  badgeCss,
  escapeCssContent,
  initials,
  onePerLine,
} from '../src/browser/presence.ts';

// Minimal DOM: the binding owns one <style> element for peer colours.
const appendedRules = [];
globalThis.document = {
  createElement: () => ({
    append: (rule) => void appendedRules.push(rule),
    remove: () => {},
  }),
  head: { appendChild: () => {} },
};

function makeModel(text) {
  const lines = () => text.split('\n');
  return {
    isDisposed: () => false,
    dispose: () => {},
    getValue: () => text,
    getEOL: () => '\n',
    onDidChangeContent: () => ({ dispose: () => {} }),
    getOffsetAt: (pos) => {
      const ls = lines();
      let offset = 0;
      for (let i = 0; i < pos.lineNumber - 1; i += 1) offset += ls[i].length + 1;
      return offset + pos.column - 1;
    },
    getPositionAt: (offset) => {
      const ls = lines();
      let rest = offset;
      for (let i = 0; i < ls.length; i += 1) {
        if (rest <= ls[i].length) return { lineNumber: i + 1, column: rest + 1 };
        rest -= ls[i].length + 1;
      }
      return { lineNumber: ls.length, column: ls[ls.length - 1].length + 1 };
    },
  };
}

function makeEditor() {
  return {
    decorations: [],
    createDecorationsCollection: function () {
      return {
        set: (next) => void (this.decorations = next),
        clear: () => void (this.decorations = []),
      };
    },
    onDidChangeCursorSelection: () => ({ dispose: () => {} }),
    getSelection: () => null,
    setModel: () => {},
    setPosition: () => {},
    revealPositionInCenter: () => {},
  };
}

function makeEngine(texts, overrides = {}) {
  const listeners = new Set();
  return {
    texts,
    listeners,
    session: () => ({ role: 'guest', roomId: 'r-test', peer: { peer_id: 'self', display_name: 'self', role: 'guest' }, documents: ['a.txt'] }),
    text: (path) => texts.get(path) ?? '',
    has: (path) => texts.has(path),
    open: async () => {},
    close: async () => {},
    openDocuments: () => [],
    insert: () => {},
    delete: () => {},
    setSelection: () => {},
    setAwareness: () => {},
    presence: () => [],
    resolveSelection: () => undefined,
    peers: () => [],
    documents: () => [...texts.keys()],
    grantedPaths: () => [],
    on: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

function cursor(peerId, label, head, anchor = head) {
  return {
    peerId,
    label,
    role: 'guest',
    path: 'a.txt',
    anchor,
    head,
    colour: '#e06c75',
    fill: '#e06c7540',
  };
}

describe('initials', () => {
  it('takes the first two code points, never half a surrogate pair', () => {
    assert.equal(initials('sam'), 'sa');
    assert.equal(initials('q'), 'q');
    assert.equal(initials('😀xy'), '😀x');
  });

  it('falls back to the bullet when the name yields no letters', () => {
    assert.equal(initials(''), ANONYMOUS_INITIALS);
  });
});

describe('onePerLine', () => {
  it('keeps the lowest peer id when a line is shared', () => {
    const a = { peerId: 'peer-b', line: 3 };
    const b = { peerId: 'peer-a', line: 3 };
    const c = { peerId: 'peer-c', line: 5 };
    const chosen = onePerLine([a, b, c], (entry) => entry.line);
    assert.equal(chosen.get(3), b);
    assert.equal(chosen.get(5), c);
    assert.equal(chosen.size, 2);
  });
});

describe('escapeCssContent', () => {
  it('quotes and backslashes cannot break out of the content string', () => {
    assert.equal(escapeCssContent('a"b\\c'), 'a\\"b\\\\c');
  });
});

describe('badgeCss', () => {
  it('paints the peer colour behind dark initials', () => {
    const rule = badgeCss('selvage-badge-0', 'sa', '#e06c75');
    assert.ok(rule.includes('.selvage-badge-0::after'), `no glyph-margin hook: ${rule}`);
    assert.ok(rule.includes('content:"sa"'), `no initials: ${rule}`);
    assert.ok(rule.includes('#e06c75'), `no peer colour: ${rule}`);
    assert.ok(rule.includes('#000'), `no dark initials: ${rule}`);
  });
});

describe('renderCursors parity', () => {
  it('draws a glyph-margin badge, a caret bar and a labelled hover, never a line marker', async () => {
    const engine = makeEngine(new Map([['a.txt', 'ab\ncdef\ng']]));
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('a.txt');
    appendedRules.length = 0;
    // Two peers on line 2 (offsets 3..6): one badge, two carets, no line marker.
    binding.renderCursors([cursor('peer-b', 'bob', 5, 3), cursor('peer-a', 'amy', 4)]);
    const decorations = editor.decorations;
    const glyphs = decorations.filter((entry) => entry.options.glyphMarginClassName !== undefined);
    assert.equal(glyphs.length, 1);
    const badgeClass = glyphs[0].options.glyphMarginClassName;
    assert.ok(
      appendedRules.some((rule) => rule.includes(`.${badgeClass}::after`) && rule.includes('#e06c75')),
      `badge rule missing for ${badgeClass}: ${JSON.stringify(appendedRules)}`,
    );
    // No peer underlines or washes their line: the caret bar is the whole line marker.
    const lines = decorations.filter((entry) => entry.options.isWholeLine === true);
    assert.equal(lines.length, 0, 'a whole-line decoration survived');
    for (const entry of decorations) {
      assert.ok(entry.options.hoverMessage === undefined || / · /.test(entry.options.hoverMessage.value));
    }
    const carets = decorations.filter((entry) => entry.options.hoverMessage !== undefined);
    assert.equal(carets.length, 2);
    assert.equal(carets[0].options.hoverMessage.value, 'bob · guest');
    // The caret bar stays visible: a 2px tint no wash can cover, plus the ruler tick.
    assert.ok(
      appendedRules.some((rule) => /border-left: 2px solid/.test(rule)),
      `caret bar lost: ${JSON.stringify(appendedRules)}`,
    );
    assert.ok(
      carets.every((entry) => entry.options.overviewRuler?.color === '#e06c75'),
      'overview-ruler tick lost',
    );
    binding.dispose();
  });

  it('a selection keeps its fill and no whole-line marker', async () => {
    const engine = makeEngine(new Map([['a.txt', 'ab\ncdef\ng']]));
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('a.txt');
    appendedRules.length = 0;
    binding.renderCursors([cursor('peer-a', 'amy', 5, 3)]);
    const decorations = editor.decorations;
    assert.ok(decorations.some((entry) => entry.options.inlineClassName !== undefined));
    const fill = decorations.find((entry) => entry.options.inlineClassName !== undefined);
    assert.ok(/background-color/.test(ruleFor(fill.options.inlineClassName)), 'selection fill lost');
    assert.equal(decorations.filter((entry) => entry.options.isWholeLine === true).length, 0);
    binding.dispose();
  });

  it('no peer paints its whole line, caret or selection alike', async () => {
    const engine = makeEngine(new Map([['a.txt', 'ab\ncdef\ng']]));
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('a.txt');
    appendedRules.length = 0;
    binding.renderCursors([cursor('peer-b', 'bob', 5, 3), cursor('peer-a', 'amy', 4)]);
    const lines = editor.decorations.filter((entry) => entry.options.isWholeLine === true);
    assert.equal(lines.length, 0, 'the line marker is back');
    for (const rule of appendedRules) {
      assert.ok(!/border-bottom/.test(rule), `underline rule minted: ${rule}`);
    }
    binding.dispose();
  });
});

describe('a tap on a peer caret, where a pointer would hover', () => {
  it('names the peer whose caret is at the offset', async () => {
    const engine = makeEngine(new Map([['a.txt', 'ab\ncdef\ng']]));
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('a.txt');
    binding.renderCursors([cursor('peer-a', 'amy', 4), cursor('peer-b', 'bob', 9)]);
    assert.equal(binding.peerAt(4)?.label, 'amy');
    assert.equal(binding.peerAt(9)?.label, 'bob');
    assert.equal(binding.peerAt(5), undefined, 'a caret was found past the end of a peer');
    binding.dispose();
  });

  it('names the peer whose selection covers the offset', async () => {
    const engine = makeEngine(new Map([['a.txt', 'ab\ncdef\ng']]));
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('a.txt');
    // bob holds 3..6; a tap between the ends is a tap on his text.
    binding.renderCursors([cursor('peer-b', 'bob', 6, 3)]);
    assert.equal(binding.peerAt(5)?.label, 'bob');
    assert.equal(binding.peerAt(2), undefined, 'a selection answered outside its own range');
    binding.dispose();
  });

  it('never answers with a caret drawn for the document that just closed', async () => {
    // Opening a document changes the path and the model together, and the frame
    // that re-draws the carets arrives later: an offset into the new buffer must
    // not be answered by the previous document's carets.
    const engine = makeEngine(new Map([['a.txt', 'ab\ncdef\ng'], ['b.txt', 'xy\nzw\n']]));
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('a.txt');
    binding.renderCursors([cursor('peer-a', 'amy', 4)]);
    await binding.openDocument('b.txt');
    assert.equal(binding.currentPath(), 'b.txt');
    assert.equal(binding.peerAt(4), undefined, 'the previous document answered for the new one');
    binding.dispose();
  });

  it('answers nothing when the carets drawn are not for the showing document', async () => {
    const engine = makeEngine(new Map([['a.txt', 'ab\ncdef\ng']]));
    const editor = makeEditor();
    const binding = new MonacoBinding({
      engine,
      editor,
      onNotice: () => {},
      createModel: (text) => makeModel(text),
    });
    await binding.openDocument('a.txt');
    binding.renderCursors([{ ...cursor('peer-a', 'amy', 4), path: 'b.txt' }]);
    // The caret is drawn per document, and a tap only ever lands in the one showing.
    assert.equal(binding.peerAt(4), undefined);
    binding.dispose();
  });
});

/** The minted rule for one decoration class, if any. */
function ruleFor(className) {
  const pattern = new RegExp(`\\.${className}\\s*\\{`);
  return appendedRules.find((rule) => pattern.test(rule));
}

describe('a peer name is text in the hover, never markup', () => {
  /**
   * Monaco renders a hover message as markdown and the room supplies the peer
   * name, so an unescaped name is a request the guest never made: a host
   * called `![](http://…/l.png)` fits the protocol's 32-unit display-name
   * bound, and every guest's browser fetched that URL on hover (2026-09-18).
   */
  const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

  /** No live markdown character survives: each is escaped, or is the escape. */
  function assertNoMarkup(value) {
    for (let at = 0; at < value.length; at += 1) {
      if (value[at] === '\\') {
        at += 1;
        continue;
      }
      assert.ok(!PUNCTUATION.test(value[at]), `live markdown character in ${JSON.stringify(value)}`);
    }
  }

  /** What a guest reads: the escapes come off and nothing else has changed. */
  function read(value) {
    return value.replace(/\\([\s\S])/g, '$1');
  }

  const NAMES = [
    '![](http://127.0.0.1:8099/l.png)',
    '[click](https://attacker.example)',
    '`tick`',
    '**bold**',
    '<img src=x onerror="alert(1)">',
    '<http://attacker.example>',
    'a|b~c^d',
    '# heading',
    'back\\slash',
    'demo-host',
  ];

  for (const name of NAMES) {
    it(`${JSON.stringify(name)} reaches the hover as its own characters`, async () => {
      const engine = makeEngine(new Map([['a.txt', 'ab\ncdef\ng']]));
      const editor = makeEditor();
      const binding = new MonacoBinding({
        engine,
        editor,
        onNotice: () => {},
        createModel: (text) => makeModel(text),
      });
      await binding.openDocument('a.txt');
      binding.renderCursors([cursor('peer-a', name, 4)]);
      const value = editor.decorations[0]?.options.hoverMessage?.value ?? '';
      assertNoMarkup(value);
      assert.equal(read(value), `${name} · guest`);
      binding.dispose();
    });
  }

  it('a name of letters reaches the hover exactly as it is', () => {
    assert.equal(literalMarkdown('sam'), 'sam');
    assert.equal(literalMarkdown('Ada Lovelace'), 'Ada Lovelace');
  });
});
