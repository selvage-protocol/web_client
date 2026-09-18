/**
 * The first painted frame is the final card.
 *
 * The shell's inline script runs while the parser is still reading the markup,
 * so what it decides is what paints — and the bundle's `initJoinCard` decides
 * the same two things (which shape the card is, and the remembered name) when
 * it takes over. This file runs both against the same inputs and holds them to
 * the same answer.
 *
 * Owner defect (2026-09-18): on a bare open the first frame was a card with no
 * paste box and `Selvage mark` as the mark's alt text — the 60 KB PNG had not
 * arrived — and the layout then moved 40 px under the reader as the bundle
 * filled both in.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DISPLAY_NAME_KEY, initJoinCard } from '../src/browser/join.ts';
import type { JoinCardElements } from '../src/browser/join.ts';
import { pageQueryParams } from '../src/browser/share.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const card = html.slice(html.indexOf('<div id="join">'), html.indexOf('id="workspace"'));

/** The one inline script: every pre-bundle decision the shell makes. */
function inlineScript(): string {
  const found = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(found !== null, 'the shell carries no inline script');
  return found[1] ?? '';
}

interface FakeElement {
  hidden: boolean;
  value: string;
  disabled: boolean;
  textContent: string;
  addEventListener(type: string, listener: (event: unknown) => void): void;
}

interface ShellState {
  inviteWrap: { hidden: boolean };
  nameInput: { value: string };
  armed: boolean;
}

/**
 * What the page is at the moment the parser has run the script and has not yet
 * painted: the markup's own state, then whatever the script decides. The
 * markup state is read from the shell, never assumed — a card whose paste box
 * is only hidden in the markup is exactly the frame that flashed.
 */
function runShell(search: string, stored: string): ShellState {
  const markupHidesInvite = /<label id="invite-wrap"[^>]*\shidden/.test(html);
  const elements = new Map<string, FakeElement>();
  const element = (id: string): FakeElement => {
    let found = elements.get(id);
    if (found === undefined) {
      found = {
        hidden: id === 'invite-wrap' ? markupHidesInvite : false,
        value: id === 'name' ? '' : '',
        disabled: false,
        textContent: '',
        addEventListener: () => {},
      };
      elements.set(id, found);
    }
    return found;
  };
  const window = {
    location: { search },
    localStorage: { getItem: (key: string) => (key === DISPLAY_NAME_KEY ? stored : null) },
    __selvageJoinArmed: false,
    __selvagePendingJoin: false,
  };
  const document = { getElementById: (id: string) => element(id) };
  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'document', 'URLSearchParams', inlineScript());
  run(window, document, URLSearchParams);
  return { inviteWrap: element('invite-wrap'), nameInput: element('name'), armed: window.__selvageJoinArmed };
}

function bundleCard(search: string, stored: string): JoinCardElements {
  const elements: JoinCardElements = {
    inviteWrap: { hidden: false },
    inviteInput: { value: '' },
    nameInput: { value: '' },
  };
  initJoinCard(elements, pageQueryParams(search), {
    getItem: (key: string) => (key === DISPLAY_NAME_KEY ? stored : null),
  });
  return elements;
}

describe('the card shell decides the first frame', () => {
  const SEARCHES = [
    '',
    '?room=r-1&token=tok',
    '?room=r-1',
    '?token=tok',
    '?room=&token=',
    '?room=r-1&token=tok?debug=1',
    '?debug=1&room=r-1&token=tok',
    '?room=%20r-1%20&token=tok',
  ];
  const STORED = ['', 'browser'];

  for (const search of SEARCHES) {
    for (const stored of STORED) {
      const where = `${search === '' ? 'a bare open' : search} with ${stored === '' ? 'no' : `"${stored}"`} remembered`;
      it(`${where}: the shell and the bundle agree`, () => {
        const shell = runShell(search, stored);
        const bundle = bundleCard(search, stored);
        assert.equal(shell.inviteWrap.hidden, bundle.inviteWrap.hidden, `the paste box disagrees on ${where}`);
        assert.equal(shell.nameInput.value, bundle.nameInput.value, `the name field disagrees on ${where}`);
        assert.equal(shell.armed, false, 'the inline script armed the card before the bundle');
      });
    }
  }

  it('a bare open paints the paste box; a link open paints without it', () => {
    assert.equal(runShell('', '').inviteWrap.hidden, false, 'a bare open still paints without its paste box');
    assert.equal(
      runShell('?room=r-1&token=tok', '').inviteWrap.hidden,
      true,
      'a link open still paints a paste box it will take away',
    );
  });

  it('the remembered name is on the card before the bundle arrives', () => {
    assert.equal(runShell('', 'browser').nameInput.value, 'browser');
    assert.equal(runShell('?room=r-1&token=tok', 'browser').nameInput.value, 'browser');
  });

  it('the held-submit guard is installed before the card block, so nothing can disarm it', () => {
    // The guard is the safety net: if the card block below it threw, an early
    // submit would navigate away and wipe the fields.
    const guard = html.indexOf('__selvageJoinArmed');
    const card = html.indexOf("getElementById('invite-wrap')");
    assert.ok(guard !== -1, 'no pre-bundle guard');
    assert.ok(card !== -1, 'no pre-paint card block');
    assert.ok(guard < card, 'the card block runs before the guard that protects the form');
  });

  it('the script runs while the parser still holds the shell', () => {
    const at = html.indexOf('<script>');
    assert.ok(at !== -1, 'no inline script in the shell');
    assert.ok(html.indexOf('id="invite-wrap"') < at, 'the script addresses markup the parser has not read yet');
    assert.ok(html.indexOf('id="name"') < at, 'the script addresses markup the parser has not read yet');
    assert.ok(at < html.indexOf('<script type="module"'), 'the module script is parsed first');
    assert.ok(
      !/<script[^>]*\ssrc=/.test(html.slice(0, html.indexOf('<script type="module"'))),
      'the pre-paint path waits on a fetch',
    );
  });
});

describe('the mark is painted by the shell, never fetched', () => {
  it('the card carries no image element, so no frame can show alt text or a broken box', () => {
    assert.ok(!/<img/i.test(card), 'the card still asks the network for the mark');
    assert.ok(!card.includes('alt='), 'the card mark still carries alt text');
    assert.ok(!html.includes('alt="Selvage mark"'), 'the mark alt text survives in the shell');
    assert.ok(
      /<span class="mark" aria-hidden="true"><\/span>/.test(card),
      'the card mark is not a decorative span wearing the bytes the shell carries',
    );
  });

  it("the mark is the owner's pixels in the document, carried once", () => {
    // A preload is still a race — the mark request can lose to the first paint
    // — so the bytes are in the shell instead (test/identity.test.ts checks
    // them against the site's master). Nothing here fetches anything.
    assert.ok(
      !/(src|href)=["']?mark-transparent\.png/.test(html) && !/url\(["']?mark-transparent\.png/.test(html),
      'the shell still loads the PNG mark',
    );
    assert.ok(!html.includes('favicon.svg'), 'the blank site icon still ships as a favicon');
    assert.ok(!/<link[^>]*as="image"/.test(html), 'the shell preloads an image instead');
    assert.ok(/url\("data:image\/png;base64,[^"]+"\)/.test(style), 'the mark is not in the shell');
    assert.equal(
      (style.match(/url\("data:image\/png;base64,/g) ?? []).length,
      1,
      'the mark is carried more than once',
    );
    const uses = html.match(/<span class="mark" aria-hidden="true">/g) ?? [];
    assert.equal(uses.length, 2, `the card and the brand do not both wear the mark: ${uses.length}`);
  });

  it('both marks are sized by the inline block, so first paint is final', () => {
    for (const rule of ['#join .mark', '#brand .mark']) {
      const found = style.match(new RegExp(`${rule.replace('.', '\\.')}\\s*\\{[^}]*\\}`));
      assert.ok(found !== null, `no ${rule} rule in the shell`);
      assert.match(found[0], /width:/, `${rule} has no width before paint`);
      assert.match(found[0], /height:/, `${rule} has no height before paint`);
    }
  });
});
