/**
 * The files-and-people panel's width.
 *
 * Three things are worth pinning here and none of them need a browser: the bounds a window gives the
 * panel, what a drag or a key does inside them, and what a remembered value is allowed to be. The
 * fourth is the page's own wiring — that no separator is drawn on a phone, and that the width is read
 * before the workspace paints — which is read off the shell and the bundle.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  wireSidebar,
  DEFAULT_WIDTH_REM,
  KEY_STEP_LARGE_PX,
  KEY_STEP_PX,
  MIN_WIDTH_PX,
  MAX_WIDTH_PX,
  PANE_MIN_PX,
  SIDEBAR_STORAGE_KEY,
  clampWidth,
  nextWidth,
  readSidebar,
  sidebarStorageValue,
  widthLimits,
} from '../src/browser/sidebar.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

/** A 14 px root, which is what the page sets, and a 1280 px window. */
const REM = 14;
const WIDE = 1280;

describe('the bounds a window gives the panel', () => {
  it('is never narrower than a column, and never so wide the editor loses its own', () => {
    const wide = widthLimits(WIDE);
    assert.equal(wide.min, MIN_WIDTH_PX);
    assert.equal(wide.max, MAX_WIDTH_PX);
    // A narrow window keeps the editor its room before the panel gets more.
    assert.equal(widthLimits(700).max, 700 - PANE_MIN_PX);
    // …and never less than the floor, whatever the window does.
    assert.equal(widthLimits(200).max, MIN_WIDTH_PX);
  });

  it('clamps every width into them, including a nonsense one', () => {
    assert.equal(clampWidth(50, WIDE, REM), MIN_WIDTH_PX);
    assert.equal(clampWidth(5000, WIDE, REM), MAX_WIDTH_PX);
    assert.equal(clampWidth(300, WIDE, REM), 300);
    assert.equal(clampWidth(Number.NaN, WIDE, REM), DEFAULT_WIDTH_REM * REM);
  });
});

describe('the keyboard', () => {
  it('moves the panel a step at a time, and four with Shift', () => {
    const start = 300;
    assert.equal(nextWidth(start, 'ArrowLeft', false, WIDE, REM), start - KEY_STEP_PX);
    assert.equal(nextWidth(start, 'ArrowRight', false, WIDE, REM), start + KEY_STEP_PX);
    assert.equal(nextWidth(start, 'ArrowLeft', true, WIDE, REM), start - KEY_STEP_LARGE_PX);
    assert.equal(nextWidth(start, 'ArrowRight', true, WIDE, REM), start + KEY_STEP_LARGE_PX);
  });

  it('goes to the bounds with Home and End, and leaves other keys alone', () => {
    assert.equal(nextWidth(300, 'Home', false, WIDE, REM), MIN_WIDTH_PX);
    assert.equal(nextWidth(300, 'End', false, WIDE, REM), MAX_WIDTH_PX);
    assert.equal(nextWidth(300, 'PageUp', false, WIDE, REM), undefined);
    assert.equal(nextWidth(300, 'a', false, WIDE, REM), undefined);
  });

  it('stops at the bounds rather than running past them', () => {
    assert.equal(nextWidth(MIN_WIDTH_PX, 'ArrowLeft', true, WIDE, REM), MIN_WIDTH_PX);
    assert.equal(nextWidth(MAX_WIDTH_PX, 'ArrowRight', true, WIDE, REM), MAX_WIDTH_PX);
  });
});

describe('what is remembered', () => {
  it('round-trips a width', () => {
    assert.deepEqual(readSidebar(sidebarStorageValue({ width: 301.6 })), { width: 302 });
    // A panel remembered as shut by an older page opens at its width.
    assert.deepEqual(readSidebar('{"width":294,"collapsed":true}'), { width: 294 });
  });

  it('ignores anything else a browser may be holding under that key', () => {
    for (const junk of [null, '', 'nonsense', '{}', '{"width":"wide"}', '{"collapsed":true}', '[1,2]', '"x"']) {
      assert.equal(readSidebar(junk), undefined, `${junk} was read as a width`);
    }
  });
});

describe('a device with no panel of its own width', () => {
  /** The smallest element `wireSidebar` touches. */
  function element(extra = {}) {
    const node = {
      style: {},
      dataset: {},
      hidden: false,
      listeners: {},
      attributes: {},
      classList: { add: () => {}, remove: () => {} },
      setAttribute(name, value) {
        node.attributes[name] = value;
      },
      removeAttribute(name) {
        delete node.attributes[name];
      },
      addEventListener(type, run) {
        (node.listeners[type] ??= []).push(run);
      },
      removeEventListener: () => {},
      ...extra,
    };
    return node;
  }

  it('leaves the panel’s own state to the disclosure it is on a phone', () => {
    // On a phone the separator is not rendered at all. A separator that wrote `hidden` there reopened
    // the panel the person shut — on a rotation, on the soft keyboard, on any resize.
    const views: boolean[] = [];
    globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
    const side = element();
    const separator = element();
    const sidebar = wireSidebar({
      elements: { side, separator },
      active: () => false,
      remPx: () => REM,
      viewportWidth: () => WIDE,
      relayout: () => {},
      frame: (run) => run(),
    });
    sidebar.apply();
    assert.equal(side.hidden, false, 'the separator shut a panel it does not own');
    assert.equal(side.style.width, '', 'the separator set a width on a device that has none');
    // It is the disclosure that owns the state, and the separator never writes it.
    side.hidden = true;
    sidebar.apply();
    assert.equal(side.hidden, true, 'the separator reopened the panel');
    views.push(side.hidden);
    assert.deepEqual(views, [true]);
  });

  it('cannot be shut: a drag past the floor stops at it', () => {
    globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };
    const side = element();
    const separator = element({ setPointerCapture: () => {}, releasePointerCapture: () => {} });
    const sidebar = wireSidebar({
      elements: { side, separator },
      remPx: () => REM,
      viewportWidth: () => WIDE,
      relayout: () => {},
      frame: (run) => run(),
    });
    sidebar.apply();
    for (const run of separator.listeners.pointerdown) run({ button: 0, clientX: 400, pointerId: 1, preventDefault: () => {} });
    for (const run of separator.listeners.pointermove) run({ clientX: 0 });
    assert.equal(sidebar.width(), MIN_WIDTH_PX);
    assert.equal(side.hidden, false, 'the drag shut the panel');
    for (const run of separator.listeners.keydown) run({ key: 'Enter', preventDefault: () => {} });
    assert.equal(side.hidden, false, 'Enter shut the panel');
  });
});

describe('the page’s own wiring', () => {
  it('reads the remembered width before the workspace paints', () => {
    assert.match(main, /wireSidebar\(\{/, 'the panel has no edge');
    assert.match(main, /sidebar\.apply\(\)/, 'the remembered width is never applied');
    assert.match(main, /storage: window\.localStorage/, 'the width is not remembered per browser');
    // Applied at module scope — the call sits at column 0, not inside a function — so nothing paints
    // at one width and jumps to another once a session is seated.
    assert.match(main, /\nsidebar\.apply\(\);/, 'the width is applied from inside something else');
    assert.equal(SIDEBAR_STORAGE_KEY, 'selvage.sidebar');
  });

  it('is a separator a keyboard can reach', () => {
    const separator = /<div id="side-resizer"[^>]*>/.exec(html)?.[0] ?? '';
    assert.match(separator, /role="separator"/, 'the edge is not the platform’s separator');
    assert.match(separator, /aria-orientation="vertical"/, 'the separator claims the wrong axis');
    assert.match(separator, /tabindex="0"/, 'the separator cannot be focused');
    assert.match(separator, /aria-valuemin="\d+"/, 'the separator carries no bound');
    assert.match(separator, /aria-valuemax="\d+"/);
    assert.match(separator, /aria-valuenow="\d+"/);
    const sidebar = readFileSync(new URL('../src/browser/sidebar.ts', import.meta.url), 'utf8');
    assert.match(sidebar, /aria-valuenow/, 'the readout never moves with the width');
    assert.match(sidebar, /aria-valuetext/, 'a screen reader hears a bare number of pixels');
  });

  it('states the width the panel renders at: its own box and not its content', () => {
    // The separator's `aria-valuenow` is the width `paint()` writes, so what it writes has to be
    // the width the panel renders at. The shell's other boxes are `border-box`; `#side` was not, so
    // the 0.7em of padding each side sat outside the declared width and a 374 px value rendered
    // 394 px at the reviewer's window, with `aria-valuetext` reading 26.7 rem for a 28.1 rem panel.
    assert.match(
      style,
      /#side \{[^}]*box-sizing:\s*border-box/,
      'the width the separator states is not the width the panel renders at',
    );
    const source = readFileSync(new URL('../src/browser/sidebar.ts', import.meta.url), 'utf8');
    // And both read the one number: the width is clamped once, in `paint`, so the style, the readout
    // and the next remembered value are the same width rather than three roundings of it.
    assert.match(
      source,
      /width = clampWidth\(width, options\.viewportWidth\(\), options\.remPx\(\)\);/,
      'the painted width is not brought inside the bounds the readout states',
    );
    assert.match(
      source,
      /separator\.setAttribute\('aria-valuenow', String\(rounded\)\)/,
      'the readout is not the width the panel is given',
    );
    assert.match(
      source,
      /side\.style\.width = `\$\{rounded\}px`/,
      'the painted width is not the width the readout states',
    );
  });

  it('lets the pointer go and keeps the drag, and resets on a double click', () => {
    assert.match(main, /wireSidebar\(\{/, 'the panel is not wired');
    const sidebar = readFileSync(new URL('../src/browser/sidebar.ts', import.meta.url), 'utf8');
    assert.match(sidebar, /pointermove/, 'the drag moves nothing');
    assert.match(sidebar, /setPointerCapture/, 'a fast drag would stop at the edge of the target');
    assert.match(sidebar, /'dblclick', onDoubleClick/, 'no way back to the width it starts at');
    assert.doesNotMatch(sidebar, /collapsed/, 'the panel can still be shut');
  });

  it('is an 8 px hit area around a 1 px line, and no handle at all on a phone', () => {
    const phone = style.slice(style.indexOf('@media (any-hover: none) and (max-width: 640px)'));
    assert.match(phone, /#side-resizer \{ display: none; \}/, 'a phone is offered a drag handle');
    assert.match(style, /#side-resizer \{[^}]*width: 8px/, 'the drag target is not 8 px wide');
    assert.match(style, /#side-resizer::before \{[^}]*width: 1px/, 'the line is not 1 px');
    assert.match(style, /#side-resizer \{[^}]*cursor: col-resize/, 'the pointer does not say what it does');
  });

  it('narrows its own contents rather than its columns, at a container query on the panel', () => {
    assert.match(style, /#side \{[^}]*container-type: inline-size/, 'the panel measures no container');
    assert.match(style, /@container side \(max-width: 18rem\)/, 'nothing answers a narrow panel');
    assert.match(style, /@container side \(max-width: 18rem\) \{[\s\S]*?#tree button\.row, #tree summary \{ padding-left/,
      'a narrow panel keeps the padding of a wide one and loses the tree');
  });
});
