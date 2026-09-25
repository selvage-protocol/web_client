/**
 * The mobile pass: what a touch-only browser is given instead of the desktop
 * layout, and what that costs a device with a pointer (nothing).
 *
 * Two things are pinned here. The first is the decision itself — `mobile.ts` is
 * DOM-free, so the editor options a phone gets are asserted without a browser.
 * The second is that the shell's stylesheet and those decisions agree: a media
 * query in `public/index.html` and a `matchMedia` in `mobile.ts` that drifted
 * apart would leave a page that thinks it is a phone and paints like a desktop.
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PHONE_QUERY,
  TOUCH_QUERY,
  appHeightFor,
  editorOptionsFor,
  keyboardInsetFor,
  watchTouchQuery,
} from '../src/browser/mobile.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
// Comments removed: a rule's selector list is read off the text, and a comment
// sitting above a rule would otherwise be swallowed into its selector.
const style = html
  .slice(html.indexOf('<style>'), html.indexOf('</style>'))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The shell's own words for the narrow-or-landscape shape: a 390 px-wide window and a phone on its
 * side are one layout, and only the first of them is a width. `PHONE_QUERY`'s second arm is the
 * other half of the same list.
 */
const NARROW_QUERY = '(max-width: 640px), (any-hover: none) and (max-height: 480px)';

/**
 * The bar's own block, which is a width and not a shape: a phone on its side has the width for one
 * row of controls, so the wrapping rules answer for a narrow screen alone.
 */
const NARROW_ONLY_QUERY = '(max-width: 640px)';

/**
 * The declarations of the first rule whose selector list *is* `selector` — one
 * entry of a comma-separated list counts, a longer selector that merely ends in
 * it does not. Reading the text keeps this suite DOM-free, which is how the
 * whole shell is tested here.
 */
function declarations(text: string, selector: string): string {
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = (match[1] ?? '').split(',').map((entry) => entry.trim());
    if (list.includes(selector)) return match[2] ?? '';
  }
  return assert.fail(`no ${selector} rule`);
}

/**
 * The body of the first `@media <header>` block, braces balanced. The header is
 * matched with the `{` that opens its block, so the touch query cannot match
 * the phone block that merely starts with the same words.
 */
function mediaBlock(header: string): string {
  const at = style.indexOf(`@media ${header} {`);
  assert.ok(at !== -1, `no @media ${header} block in the shell`);
  const open = style.indexOf('{', at);
  let depth = 0;
  for (let index = open; index < style.length; index += 1) {
    if (style[index] === '{') depth += 1;
    else if (style[index] === '}') {
      depth -= 1;
      if (depth === 0) return style.slice(open + 1, index);
    }
  }
  return assert.fail(`@media ${header} is never closed`);
}

describe('the editor a phone gets', () => {
  it('hands a pointer device exactly the options it has always had', () => {
    assert.deepEqual(editorOptionsFor(false), { minimap: { enabled: true, side: 'right' } });
  });

  it('drops the minimap, wraps lines and raises the type on a touch device', () => {
    const phone = editorOptionsFor(true);
    assert.equal(phone.minimap?.enabled, false, 'the minimap still eats 38 px of a 390 px screen');
    assert.equal(phone.wordWrap, 'on', 'a long line still scrolls sideways inside a scrolling page');
    assert.equal(phone.fontSize, 16, 'the editor input is under the size iOS zooms at');
    assert.ok((phone.scrollbar?.verticalScrollbarSize ?? 0) >= 14, 'the scrollbar is a hairline');
    assert.equal(phone.minimap?.side, undefined, 'a side without a minimap');
  });

  it('narrows the gutter, and keeps the one column of it this page draws in', () => {
    // Measured in Chromium at 390x844: the line numbers, the fold arrows and the decoration width
    // took 96 of the 390 px — a quarter of the screen, and 30 % at 320 — for numbers no phone
    // document reaches and arrows a fingertip cannot hit. The glyph margin is the column a peer's
    // badge is drawn in, so it stays. What is left of the 55 px this adds up to is the separation
    // the number and the code need: measured before, the number's ink ended at x=51 and the code
    // started at x=55 — 4 px, against the 26 a pointer device has.
    const phone = editorOptionsFor(true);
    assert.equal(phone.lineNumbersMinChars, 2, 'the line-number column is wider than a phone document needs');
    assert.equal(phone.folding, false, 'the fold arrows still take a column of a phone\u2019s gutter');
    assert.equal(phone.lineDecorationsWidth, 14, 'the code is left against the line numbers again');
    assert.equal(phone.glyphMargin, true, 'the peer badges lost the column they are drawn in');
  });
});

describe('the visual viewport a soft keyboard shrinks', () => {
  it('follows a viewport that got shorter without a zoom', () => {
    assert.equal(appHeightFor({ height: 420, scale: 1 }, 844), 420);
  });

  it('leaves the app to its own 100dvh when nothing shrank', () => {
    assert.equal(appHeightFor({ height: 844, scale: 1 }, 844), undefined);
    assert.equal(appHeightFor(undefined, 844), undefined);
  });

  it('declines a pinch-zoom, which is a visual-viewport shrink too', () => {
    assert.equal(appHeightFor({ height: 422, scale: 2 }, 844), undefined);
  });

  it('rounds to whole pixels, which is all a layout can use', () => {
    assert.equal(appHeightFor({ height: 419.6, scale: 1 }, 844), 420);
  });

  it('measures the distance a fixed line has to clear to stay above the keyboard', () => {
    assert.equal(keyboardInsetFor({ height: 420, scale: 1, offsetTop: 0 }, 844), 424);
    assert.equal(keyboardInsetFor({ height: 420, scale: 1, offsetTop: 40 }, 844), 384);
  });

  it('leaves the transient lines where they are when nothing shrank', () => {
    assert.equal(keyboardInsetFor({ height: 844, scale: 1 }, 844), 0);
    assert.equal(keyboardInsetFor({ height: 422, scale: 2 }, 844), 0);
    assert.equal(keyboardInsetFor(undefined, 844), 0);
  });

  it('re-decides when a pointer is attached or removed mid-session', () => {
    const listeners: (() => void)[] = [];
    const query = {
      matches: false,
      addEventListener: (type: string, listener: () => void): void => {
        if (type === 'change') listeners.push(listener);
      },
    };
    const seen: boolean[] = [];
    watchTouchQuery(query, (touch) => seen.push(touch));
    assert.deepEqual(seen, [], 'the decision ran before the device changed');
    assert.equal(listeners.length, 1, 'nothing listens on the touch query');
    query.matches = true;
    for (const listener of listeners) listener();
    assert.deepEqual(seen, [true], 'a pointer attached mid-session never re-applied the decision');
  });
});

describe('the shell and the page agree on what a phone is', () => {
  it('carries both queries the page matches on', () => {
    assert.ok(style.includes(`@media ${TOUCH_QUERY}`), `the shell has no ${TOUCH_QUERY} block`);
    assert.ok(style.includes(`@media ${PHONE_QUERY}`), `the shell has no ${PHONE_QUERY} block`);
    assert.equal(PHONE_QUERY.startsWith(`${TOUCH_QUERY} and `), true, 'the phone query is not the touch query, narrowed');
  });

  it('answers for a phone on its side as well as one held upright', () => {
    // Measured at 844x390 with touch: the desktop column came back — a 196 px panel beside the
    // editor, the strip's own download control at x=803, a 60 px footer that was not compacted,
    // and roster names cut to 5 px of themselves. A phone has two shapes and the width query can
    // see one of them, so the phone query has an arm for each and both shell blocks carry both.
    const landscape = `${TOUCH_QUERY} and (max-height: 480px)`;
    assert.ok(PHONE_QUERY.includes(landscape), 'the phone query has no arm for a short screen');
    // Both blocks are written out in full, and both carry the short-screen arm in their own header:
    // reading each by that header is what says so.
    assert.match(declarations(mediaBlock(NARROW_QUERY), '#workspace'), /flex-direction:\s*column/,
      'the narrow-or-landscape layout is not the stacked one');
    assert.match(declarations(mediaBlock(PHONE_QUERY), '#side-resizer'), /display:\s*none/,
      'the phone\u2019s own block does not answer for a phone on its side');
  });

  it('gives the bar’s own verb room by saying less of it, not by dropping it', () => {
    // Measured at 390x844: `Leave and end the room` is 213 px of a 390 px bar, so it wrapped onto
    // a row of its own and the session bar took 138 px of the screen for the whole session. What
    // the press costs is the control's accessible name, its tooltip, and the question it opens.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /shortLabel: \(\) => phoneLayout\.matches/, 'the bar has no short verb on a phone');
    assert.match(main, /phoneLayout\.addEventListener\('change', \(\) => leaveControl\.showRole/,
      'a pointer arriving leaves the phone\u2019s verb behind');
  });

  it('keeps the safe-area inset inside the height it is measured against', () => {
    assert.match(declarations(style, '#app'), /box-sizing:\s*border-box/, 'the inset pushes the app past 100dvh');
  });

  it('hides the pre-join backdrop where two panes no longer fit behind the card', () => {
    // The backdrop draws the desktop layout: the panel's width of tree beside a
    // code pane.
    // At this width the card's sheet covers what is left of the code, which is
    // the grey-bars failure again — so the phone gets the veil over the plain
    // background, and the card alone.
    assert.match(
      declarations(mediaBlock(NARROW_QUERY), '#preview'),
      /display:\s*none/,
      'the backdrop still paints a code pane too narrow to read on a phone',
    );
  });

  it('lets the layout viewport follow the browser chrome and the keyboard', () => {
    const app = declarations(style, '#app');
    assert.ok(app.includes('height: 100dvh'), `#app does not use the dynamic viewport: ${app}`);
    assert.ok(
      app.indexOf('height: 100%') < app.indexOf('height: 100dvh'),
      'no fallback is declared before `dvh`, so a browser without it loses the height',
    );
    assert.match(html, /name="viewport" content="[^"]*viewport-fit=cover/, 'no cover: the insets are zero');
    assert.match(
      html,
      /name="viewport" content="[^"]*interactive-widget=resizes-content/,
      'Android is left to overlay the keyboard rather than resize for it',
    );
  });

  it('keeps the last row off a phone’s home indicator', () => {
    assert.ok(style.includes('env(safe-area-inset-bottom)'), 'no bottom inset anywhere');
    assert.match(mediaBlock(PHONE_QUERY), /#join\s*\{[^}]*env\(safe-area-inset-bottom\)/);
    assert.match(mediaBlock(TOUCH_QUERY), /#alert[^{]*\{[^}]*env\(safe-area-inset-bottom\)/);
  });

  it('lifts the transient lines with the visual viewport, like the app', () => {
    assert.match(declarations(style, '#peek'), /var\(--keyboard-inset/, '#peek is parked under the keyboard');
    assert.match(declarations(style, '#alert'), /var\(--keyboard-inset/, '#alert is parked under the keyboard');
  });

  it('puts the failure alert above the tap line where the two collide', () => {
    const zIndex = (selector: string): number => {
      const found = /(?:^|;)\s*z-index:\s*(\d+)/.exec(declarations(style, selector));
      return Number(found?.[1]);
    };
    assert.ok(
      zIndex('#alert') > zIndex('#peek'),
      `#alert z ${zIndex('#alert')} does not paint over #peek z ${zIndex('#peek')}`,
    );
  });

  it('re-reads the touch query as a pointer arrives, not once at load', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(
      main.includes('watchTouchQuery(touchLayout,'),
      'the touch decision is never revisited when the device changes',
    );
    assert.ok(main.includes('applyTouchMode()'), 'a changed touch query re-applies nothing');
  });

  it('follows a visual-viewport pan, not only a resize', () => {
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /addEventListener\('resize',\s*fitVisualViewport\)/, 'the visual viewport is never watched');
    assert.match(
      main,
      /addEventListener\('scroll',\s*fitVisualViewport\)/,
      'a pan moves the visual viewport without a resize, and the inset is measured from its offset',
    );
  });
});

describe('the sizes a finger needs', () => {
  it('clears the 16 px floor iOS zooms a focused field below', () => {
    const touch = mediaBlock(TOUCH_QUERY);
    assert.match(declarations(touch, '#join input'), /font-size:\s*16px/, 'the fields are back under the zoom floor');
    assert.match(declarations(touch, '#join-message'), /font-size:\s*16px/, 'the line that says the room is gone is the smallest thing on the card');
    assert.match(declarations(touch, '#share'), /font-size:\s*16px/, 'the copy fallback focuses a field under the zoom floor');
  });

  it('gives every control a 44 px box to hit', () => {
    const touch = mediaBlock(TOUCH_QUERY);
    assert.match(declarations(touch, 'button'), /min-height:\s*44px/, 'buttons are under the target size');
    assert.match(declarations(touch, 'summary'), /min-height:\s*44px/, 'tree folders are under the target size');
    const share = declarations(touch, '#share-group');
    assert.match(share, /min-height:\s*44px/, 'the copy control is a 24 px strip');
    // A content-box `min-height` is a floor on the content, and the padding sits
    // outside it: the strip rendered 63 px tall for a 44 px floor before this.
    assert.match(share, /box-sizing:\s*border-box/, 'the 44 px floor is not the box the finger hits');
    assert.match(declarations(touch, '#roster .actions button'), /min-width:\s*44px/, 'roster verbs stay 26 px wide');
    // A row's own action, measured at 390x844: the download control and a folder's `\u22ef` are both
    // 24x44 — one glyph in a box a thumb is four times too wide for, on a row whose own press opens
    // the file, which for a guest opens it for every peer.
    assert.match(declarations(touch, '#tree .icon-button'), /min-width:\s*44px/, 'row actions stay 24 px wide');
  });

  it('gives both pairs of ✓ and ✕ the width of a fingertip, and room between them', () => {
    // The tree's create row and the roster's own name are the same two answers — keep it, drop it
    // — drawn as the same two glyphs, so they are sized together. Measured in Chromium at 390x844:
    // each glyph is 27 px wide and the two are 4 px apart, which is a miss on the field or the name
    // beside them. A miss on a file row's pair opens the file instead.
    const touch = mediaBlock(TOUCH_QUERY);
    for (const control of [
      '#tree .new-commit',
      '#tree .new-cancel',
      '#roster .rename-save',
      '#roster .rename-cancel',
    ]) {
      assert.match(
        declarations(touch, control),
        /min-width:\s*44px/,
        `${control} is as wide as its glyph again`,
      );
    }
    assert.match(declarations(touch, '#tree .new-line'), /gap:\s*0\.6em/, 'the two answers abut');
    assert.match(declarations(touch, '#roster .rename-edit'), /gap:\s*0\.6em/, 'the two answers abut');
  });

  it('keeps the desktop density: the sizes above are behind the touch query', () => {
    assert.ok(
      !/min-height:\s*44px/.test(style.slice(0, style.indexOf(`@media ${TOUCH_QUERY}`))),
      'a 44 px target leaked into the desktop layout',
    );
    assert.match(declarations(style, '#join input'), /font-size:\s*1rem/, 'the desktop field size moved');
  });
});

describe('the panel on a phone', () => {
  it('is shut unless the guest opens it, and the editor keeps the screen', () => {
    // One disclosure for one panel. The shell carried a second — an icon-only `☰` button in the
    // strip — and it could never paint: its `hidden` attribute is `display: none !important` in the
    // same stylesheet, so the phone query's `display: flex` never landed, and a button inside the
    // strip's own `role="button"` is a control within a control. What opens the panel on a phone is
    // the strip, which is the whole row a fingertip has.
    assert.ok(!html.includes('panel-toggle'), 'the shell carries a second control for the panel');
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /fileStrip\.addEventListener\('click'/, 'nothing on a phone opens the panel');
    assert.match(main, /showPanel\(!phoneLayout\.matches\)/, 'the panel does not start shut on a phone');
  });

  it('keeps the roster to one alignment: no row grows a second line', () => {
    // Measured at 390x844 with five peers: a long name wrapped the row's verbs onto a line of
    // their own, left-aligned at x=17 and 82 px tall, while a short name kept them right-aligned on
    // the name's line at x=207 and 57 px. Two alignments and two heights in one list, and the
    // phrase a reader scans for — `not in a file yet` — in a different place on every row.
    const row = declarations(mediaBlock(TOUCH_QUERY), '#roster li');
    assert.match(row, /flex-wrap:\s*nowrap/, 'the verbs drop to a line of their own again');
    assert.ok(!/flex-wrap:\s*wrap/.test(row), 'a roster row still wraps its actions');
  });

  it('makes its cap the box the panel actually takes', () => {
    const stacked = declarations(mediaBlock(NARROW_QUERY), '#side');
    assert.match(stacked, /max-height:\s*60%/, 'the cap changed: a narrow window cannot reach its files');
    assert.match(stacked, /box-sizing:\s*border-box/, 'the padding and border sit outside the cap again');
  });

  it('takes the whole of what the strip leaves, and keeps the editor off the screen while it is up', () => {
    // Measured at 390x844 with five peers: the 60 % cap made the panel 402 px of a 627 px
    // workspace, its content 756 px, and the first file row sat 58 px *below* the panel's own
    // bottom edge (320x640: 272 px of 507, first row 166 px below) — the tree behind an inner
    // scroller with nothing to say it scrolled. A touch device has one screen and the panel is the
    // thing on it, so the panel takes what the strip leaves and the editor is out of the flow.
    const phone = mediaBlock(PHONE_QUERY);
    const panel = declarations(phone, '#side');
    assert.match(panel, /max-height:\s*none/, 'the phone still caps the panel at a share of the screen');
    assert.match(panel, /flex:\s*1 1 auto/, 'the panel does not take the room the strip leaves');
    assert.match(panel, /min-height:\s*0/, 'the panel cannot shrink to the box it is given');
    assert.match(html, /body:has\(#side:not\(\[hidden\]\)\) #editor-area \{ display: none; \}/,
      'the editor stands behind the panel with a screen it cannot have');
    assert.match(html, /body:has\(#side:not\(\[hidden\]\)\) #pane \{ flex: none; \}/,
      'the pane and the panel split the screen between them');
  });

  it('does not move the disclosure that opens it', () => {
    // Measured at 390x844 with a file open: the strip sat at y=138 with the panel shut and y=481
    // with it open, because the panel was the first thing in the column. The tap that opened the
    // panel was 343 px from the tap that closes it. The pane is first in the column now and the
    // panel opens under it.
    const narrow = mediaBlock(NARROW_QUERY);
    assert.match(declarations(narrow, '#workspace'), /flex-direction:\s*column/, 'the two panes are still a row');
    assert.match(declarations(narrow, '#pane'), /order:\s*1/, 'the strip is not the first thing in the column');
    assert.match(declarations(narrow, '#side'), /order:\s*2/, 'the panel does not open under the strip');
  });

  it('keeps the follow segment to one line, so the file it is about keeps its name', () => {
    // Measured at 390x844 following a peer with a long name: the segment wrapped to three lines,
    // the strip grew to 72 px and the file's own name was cut to 50 px (`REA…`); at 320 it was
    // five lines, a 109 px strip and `RE…`. The strip is the phone's one row of state.
    const phone = mediaBlock(PHONE_QUERY);
    assert.match(
      declarations(phone, '#file-strip-follow .follow-name'),
      /text-overflow:\s*ellipsis/,
      'the followed peer\u2019s name takes as many lines as it likes',
    );
    assert.match(
      declarations(phone, '#file-strip-follow .follow-name'),
      /min-width:\s*0/,
      'the segment cannot shrink below the name it carries',
    );
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /label\.className = 'follow-name'/, 'the name the stylesheet holds is not on it');
  });

  it('carries a mark of its own, and a state, on the line that opens the panel', () => {
    // The strip was the panel's only way in and said nothing about it: a file's name and no
    // chevron, no icon and no expanded state, so with a file open a guest could not tell that
    // files or people existed at all.
    const phone = mediaBlock(PHONE_QUERY);
    assert.match(declarations(phone, '#file-strip .disclosure'), /margin-left:\s*auto/,
      'the mark is not at the strip\u2019s own edge');
    assert.match(html, /#file-strip\[aria-expanded='true'\] \{ background: var\(--muted\)/,
      'the open panel looks like the shut one');
    assert.match(html, /#file-strip\[aria-expanded='true'\] \.disclosure \{ transform: rotate\(90deg\); \}/,
      'the mark does not say which way the panel went');
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /stripDisclosure = iconSpan\('chevron'\)/, 'the strip is drawn without a mark');
    assert.match(main, /stripDisclosure\?\.remove\(\)/, 'a pointer device carries the phone\u2019s mark');
  });

  it('opens for a room that shares nothing, so the blank editor is explained', () => {
    // Nothing else on a phone says the room is empty: the editor shows line 1
    // and the panel, shut, holds the one sentence that does.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    const openFirst = main.slice(main.indexOf('async function openFirst'), main.indexOf('async function openPath'));
    const opened = openFirst.indexOf('showPanel(true)');
    assert.ok(opened !== -1, 'a phone opening an empty room gets a blank editor and nothing else');
    assert.ok(
      openFirst.indexOf('phoneLayout.matches') < opened,
      'the panel opens for a room that did name a document too',
    );
    assert.ok(
      /if \(first !== undefined\) \{[\s\S]*?return;[\s\S]*?\}/.test(openFirst.slice(0, opened)),
      'the panel opens even when a file was just opened into the editor',
    );
  });
});

describe('what a phone cannot hover', () => {
  it('names the copy control at every width, and hides the readout where it stands in', () => {
    // Measured in Chromium 152 at 412x915: the control was 381x44 px holding a
    // 14x14 icon and no text at all — an empty field with a link glyph in it. Above
    // 640 px the words were the thing the query hid, so a host read an icon and a
    // shortened link with nothing that said what pressing it does.
    // Both narrow blocks: what has to hold is that nothing outside them hides the words.
    const phone = mediaBlock(NARROW_QUERY) + mediaBlock(NARROW_ONLY_QUERY);
    // Every rule that touches the words, and which of them is inside those blocks:
    const labelRules = [...style.matchAll(/#share-group[^{}]*\.share-label[^{}]*\{[^{}]*\}/g)].map(
      (match) => match[0],
    );
    assert.ok(labelRules.length > 0, 'no rule styles the copy control\u2019s words');
    const outsideThePhone = labelRules.filter((rule) => !phone.includes(rule));
    assert.ok(outsideThePhone.length > 0, 'the scan reached no rule outside the phone block');
    for (const rule of outsideThePhone) {
      assert.ok(!/display:\s*none/.test(rule), `the words are hidden at desktop widths: ${rule}`);
    }
    assert.match(declarations(phone, '#share-group #share'), /display:\s*none/, 'the label shows without the readout hidden');
    // Measured in Chromium at 1024 px: with the words beside it the readout kept its own
    // content width and painted 139 px of the value past the pill's right edge — the field's
    // automatic minimum size is its content, so `max-width` alone cannot shrink it.
    assert.match(
      declarations(style, '#share'),
      /min-width:\s*0/,
      'the readout cannot give up the room the words take',
    );
    assert.match(
      html,
      /<span class="share-label" aria-hidden="true">Copy invite link<\/span>/,
      'the shell carries no words for the copy control',
    );
    // The group's own label already names the control, so the visible copy of
    // those words is what a screen reader must not read out twice.
    const group = html.slice(html.indexOf('id="share-group"'), html.indexOf('id="share"'));
    assert.match(group, /aria-label="Copy invite link"/, 'the control lost its accessible name');
  });

  it('says where a peer is in the row, for the finger that cannot hover it', () => {
    // There is no dead verb left to explain: a peer with nothing open reads where they are, at every
    // width and with no `title` behind it. What is pinned is the line's own style, which is text on
    // screen rather than a tooltip.
    assert.match(declarations(style, '#roster .waiting'), /color:\s*var\(--muted-foreground\)/);
    assert.doesNotMatch(style, /#roster \.why/, 'a dead verb’s explanation is still in the shell');
  });

  it('keeps the waiting line on the row it belongs to, not floating above it', () => {
    // Measured at 390x844: `not in a file yet` sat in the same action row as the Follow button,
    // stretched to that button's 44 px height with its text at the top of the box, so it read as a
    // line of its own above the peer. The action row centres its children.
    assert.match(
      declarations(style, '#roster .actions'),
      /align-items:\s*center/,
      'the waiting line floats above the row it belongs to',
    );
  });

  it('carries a tap-revealed line for the peer a caret belongs to', () => {
    assert.ok(html.includes('id="peek"'), 'no tap-revealed line in the shell');
    assert.match(declarations(style, '#peek'), /position:\s*fixed/);
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes("addEventListener('touchend'"), 'nothing reveals a hover on a tap');
    assert.ok(main.includes('peerAt('), 'a tap never asks whose caret it landed on');
  });
});

describe('the pre-join card on a phone, and the page under it', () => {
  it('anchors the card near the top rather than to the bottom of the screen', () => {
    // Measured in Chromium 152 at 390x844: the card was a sheet at the bottom, so the top
    // ~45 % of the screen was empty and the footer the demo appends under the page sat below
    // the fold. The card is anchored near the top now, and its first line is the action.
    const card = declarations(mediaBlock(PHONE_QUERY), '#join');
    assert.ok(!/bottom:\s*0/.test(card), `the card is still a bottom sheet: ${card}`);
    assert.ok(!/top:\s*auto/.test(card), `the card is still taken out of the top: ${card}`);
    assert.match(card, /top:\s*max\(/, `the card is not anchored near the top: ${card}`);
    assert.match(card, /env\(safe-area-inset-bottom\)/, 'the card lost the home-indicator inset');
  });

  it('opens the page under the app, so a deployment footer is not pushed below the fold', () => {
    // The demo's nginx injects a non-commercial notice and a terms link before `</body>`, after
    // `#app`. A full-height app laid out after it pushed that notice past the fold.
    assert.match(style, /body\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/, 'the page is not a column');
    assert.match(style, /body\s*\{[^}]*min-height:\s*100dvh/, 'the column has no dynamic minimum height');
    const app = declarations(style, '#app');
    assert.match(app, /flex:\s*1 1 auto/, 'the app does not give up room to a footer');
    assert.match(app, /min-height:\s*0/, 'the app cannot shrink for a footer');
    assert.ok(app.includes('height: 100dvh'), 'the app lost the dynamic viewport that follows the keyboard');
  });

  it('shrinks that notice once a session is on screen, and leaves it whole on arrival', () => {
    // Measured in Chromium at 390x844 with `--footer`: the notice is three lines of prose, 80 px
    // — about a tenth of the screen — held for the whole session, and 35 px once a session is on
    // screen. While the card is up it is the full proof it is meant to be; a session is what makes
    // the room scarce. The declarations have to be `!important`: the notice carries its own inline
    // styles, and the deployment that injects it gives it no class or id this page could reach.
    const phone = mediaBlock(NARROW_QUERY);
    const rule = /body:has\(#session:not\(\[hidden\]\)\) > aside\s*\{([^}]*)\}/.exec(phone)?.[1] ?? '';
    assert.notEqual(rule, '', 'the demo notice keeps its full height through a phone session');
    assert.equal(
      (rule.match(/!important/g) ?? []).length,
      3,
      `a declaration without \`!important\` loses to the notice's own inline style: ${rule}`,
    );
    assert.match(rule, /padding:\s*0\.25rem/, 'the notice kept its own padding');
    assert.match(rule, /font-size:\s*10\.5px/, 'the notice kept its own type size');
    assert.match(rule, /line-height:\s*1\.3/, 'the notice kept its own leading');
    // Nothing is hidden: the whole notice and its terms link stay, and `check-terms.sh` in the
    // reference server still reads every word of it out of the bytes the front serves.
    assert.ok(!/display:\s*none/.test(rule), 'the notice is dismissed rather than shrunk');
  });
});
