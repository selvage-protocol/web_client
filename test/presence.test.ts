/**
 * Peer-presence visibility: initials badges, one badge per line, and the
 * Monaco rendering (glyph-margin badge, whole-line highlight, labelled hover).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MonacoBinding } from '../src/browser/editor.ts';
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
  it('draws a glyph-margin badge, a caret bar, a subtle underline and a labelled hover', async () => {
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
    // Two peers on line 2 (offsets 3..6): one badge, two carets, two underlines.
    binding.renderCursors([cursor('peer-b', 'bob', 5, 3), cursor('peer-a', 'amy', 4)]);
    const decorations = editor.decorations;
    const glyphs = decorations.filter((entry) => entry.options.glyphMarginClassName !== undefined);
    assert.equal(glyphs.length, 1);
    const badgeClass = glyphs[0].options.glyphMarginClassName;
    assert.ok(
      appendedRules.some((rule) => rule.includes(`.${badgeClass}::after`) && rule.includes('#e06c75')),
      `badge rule missing for ${badgeClass}: ${JSON.stringify(appendedRules)}`,
    );
    const lines = decorations.filter((entry) => entry.options.isWholeLine === true);
    assert.equal(lines.length, 2);
    for (const entry of decorations) {
      assert.ok(entry.options.hoverMessage === undefined || / · /.test(entry.options.hoverMessage.value));
    }
    const carets = decorations.filter((entry) => entry.options.hoverMessage !== undefined);
    assert.equal(carets.length, 2);
    assert.equal(carets[0].options.hoverMessage.value, 'bob · guest');
    // The caret bar stays visible: a 2px tint no wash can cover.
    assert.ok(
      appendedRules.some((rule) => /border-left: 2px solid/.test(rule)),
      `caret bar lost: ${JSON.stringify(appendedRules)}`,
    );
    // Underline only: no whole-line rule may carry a background wash.
    for (const entry of lines) {
      const rule = ruleFor(entry.options.className);
      assert.ok(rule !== undefined, `no rule for ${entry.options.className}`);
      assert.ok(!/background/.test(rule), `full-line wash survived: ${rule}`);
      assert.ok(/border-bottom/.test(rule), `underline lost: ${rule}`);
    }
    binding.dispose();
  });

  it('a selection fill rides beside the underline, never a full-line wash', async () => {
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
    assert.ok(decorations.some((entry) => entry.options.isWholeLine === true));
    assert.ok(decorations.some((entry) => entry.options.inlineClassName !== undefined));
    for (const entry of decorations.filter((entry) => entry.options.isWholeLine === true)) {
      const rule = ruleFor(entry.options.className);
      assert.ok(rule !== undefined, `no rule for ${entry.options.className}`);
      assert.ok(!/background/.test(rule), `full-line wash survived: ${rule}`);
    }
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
    assert.ok(lines.length > 0, 'the line marker is gone entirely');
    for (const entry of lines) {
      const rule = ruleFor(entry.options.className);
      assert.ok(rule !== undefined, `no rule for ${entry.options.className}`);
      assert.ok(!/background/.test(rule), `full-line wash: ${rule}`);
    }
    binding.dispose();
  });
});

/** The minted rule for one decoration class, if any. */
function ruleFor(className) {
  const pattern = new RegExp(`\\.${className}\\s*\\{`);
  return appendedRules.find((rule) => pattern.test(rule));
}
