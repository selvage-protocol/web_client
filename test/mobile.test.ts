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

/** The body of the first `@media <header>` block, braces balanced. */
function mediaBlock(header: string): string {
  const at = style.indexOf(`@media ${header}`);
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

  it('makes its 38% cap the box the panel actually takes', () => {
    const stacked = declarations(mediaBlock('(max-width: 640px)'), '#side');
    assert.match(stacked, /max-height:\s*38%/, 'the cap left the stacked layout');
    assert.match(stacked, /box-sizing:\s*border-box/, 'the padding and border sit outside the cap again');
  });
});

describe('what a phone cannot hover', () => {
  it('shows a dead roster verb’s reason as row text', () => {
    assert.match(declarations(style, '#roster .why'), /display:\s*none/);
    assert.match(declarations(mediaBlock(TOUCH_QUERY), '#roster .why'), /display:\s*block/);
  });

  it('carries a tap-revealed line for the peer a caret belongs to', () => {
    assert.ok(html.includes('id="peek"'), 'no tap-revealed line in the shell');
    assert.match(declarations(style, '#peek'), /position:\s*fixed/);
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.ok(main.includes("addEventListener('touchend'"), 'nothing reveals a hover on a tap');
    assert.ok(main.includes('peerAt('), 'a tap never asks whose caret it landed on');
  });
});
