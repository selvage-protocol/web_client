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
      declarations(mediaBlock('(max-width: 640px)'), '#preview'),
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
    assert.match(declarations(style, '#panel-toggle'), /display:\s*none/, 'the disclosure control shows on a pointer device');
    assert.match(declarations(mediaBlock(PHONE_QUERY), '#panel-toggle'), /display:\s*flex/);
  });

  it('makes its cap the box the panel actually takes', () => {
    const stacked = declarations(mediaBlock('(max-width: 640px)'), '#side');
    assert.match(stacked, /max-height:\s*60%/, 'the cap changed: a phone cannot reach its files');
    assert.match(stacked, /box-sizing:\s*border-box/, 'the padding and border sit outside the cap again');
  });

  it('starts the panel high enough for the file it was opened to reach', () => {
    // Measured in Chromium 152 at 412x915 with one other peer: at a 38% cap the
    // panel was 314 px of the workspace and every file row sat below its fold
    // (`#side` bottom 447, the first row's top 428, the last 518) — the
    // disclosure named files and showed none. At 60% the panel is 404 px, no
    // row is cut, and the panel stops scrolling (scrollHeight 403 = clientHeight).
    const cap = /max-height:\s*(\d+)%/.exec(declarations(mediaBlock('(max-width: 640px)'), '#side'));
    assert.ok(cap, 'the stacked panel has no cap at all');
    assert.ok(Number(cap[1]) >= 60, `the cap is ${cap[1]}%: the roster pushes the tree out of the panel`);
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
    const phone = mediaBlock('(max-width: 640px)');
    // Every rule that touches the words, and which of them is inside the phone block:
    // what has to hold is that nothing outside it hides them.
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
});
