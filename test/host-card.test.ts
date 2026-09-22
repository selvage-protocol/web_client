/**
 * The card's third action, and the reload it warns about.
 *
 * Two things are pinned here. The shell's own markup: the host action is hidden, and it is a
 * `type="button"`, so it can neither submit the join form nor be armed by the pre-bundle hold
 * that guards a submit. And the decision: a page offers to start a room only where this browser
 * can hand it a folder *and* the page's own origin is a Selvage server, and what it says instead
 * when one of those is missing. A control that could only refuse is the defect both halves of
 * that are written against.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HOST_MARK_KEY,
  HOST_NEEDS_A_BROWSER,
  HOST_NEEDS_THE_SERVERS_PAGE,
  HOST_TAB_WARNING,
  clearHostingMark,
  hostAvailability,
  markHosting,
  takeHostingNotice,
} from '../src/browser/host.ts';
import type { HostStorage } from '../src/browser/host.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

/** A storage double: the session storage a tab has, and the one a private window refuses. */
function storage(initial: Record<string, string> = {}, refuse = false): HostStorage & { all: () => Record<string, string> } {
  const items = new Map(Object.entries(initial));
  const guard = (): void => {
    if (refuse) {
      throw new DOMException('denied', 'SecurityError');
    }
  };
  return {
    getItem: (key: string) => {
      guard();
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      guard();
      items.set(key, value);
    },
    removeItem: (key: string) => {
      guard();
      items.delete(key);
    },
    all: () => Object.fromEntries(items),
  };
}

describe('the host action in the shell', () => {
  it('is hidden in the markup, so the first frame offers nothing that could only refuse', () => {
    const wrap = /<div id="host-wrap"([^>]*)>/.exec(html)?.[1] ?? '';
    assert.match(wrap, /\shidden/, `the host action paints before /meta answers: ${wrap}`);
    const button = /<button id="host-button"([^>]*)>/.exec(html)?.[1] ?? '';
    assert.match(button, /type="button"/, `the host action is a submit button: ${button}`);
    assert.match(button, /\shidden/, 'the host button is not hidden by its own markup');
  });

  it('is outside the join form, so the pre-bundle hold has nothing to do with it', () => {
    const form = /<form id="join-form"[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';
    assert.ok(form !== '', 'the shell carries no join form');
    assert.ok(!form.includes('host-button'), 'a host click would submit the join form');
    assert.ok(!form.includes('host-wrap'), 'the host action sits inside the join form');
  });

  it('asks with the words the product line uses, and warns about the tab', () => {
    assert.match(html, /Start a session here/, 'the button does not say what it does');
    assert.match(HOST_TAB_WARNING, /reload/i, 'the warning does not mention a reload');
    assert.match(HOST_TAB_WARNING, /ends|closes/i, 'the warning does not say the room ends');
  });
});

describe('whether the card offers to start a room', () => {
  it('offers it only where a folder can be picked and the page is the server', () => {
    assert.deepEqual(hostAvailability({ picker: true, serverHere: true }), { kind: 'offered' });
  });

  it('explains a browser that cannot hand over a folder, and says joining still works', () => {
    const availability = hostAvailability({ picker: false, serverHere: true });
    assert.equal(availability.kind === 'explained' ? availability.sentence : '', HOST_NEEDS_A_BROWSER);
    assert.match(HOST_NEEDS_A_BROWSER, /Joining a room here still works/);
  });

  it('explains a page that is not the server\'s own page rather than guessing at one', () => {
    const availability = hostAvailability({ picker: true, serverHere: false });
    assert.equal(
      availability.kind === 'explained' ? availability.sentence : '',
      HOST_NEEDS_THE_SERVERS_PAGE,
    );
    // A picker that cannot pick is the first answer either way: the /meta read is not worth
    // making where there is nothing to do with its answer.
    assert.equal(hostAvailability({ picker: false, serverHere: false }).kind, 'explained');
  });
});

describe('what a reload leaves behind', () => {
  it('says the room is over, once, and clears the mark it read', () => {
    const store = storage();
    assert.equal(takeHostingNotice(store), undefined, 'a page nobody hosted from said something');
    markHosting(store, 'r-1');
    assert.deepEqual(store.all(), { [HOST_MARK_KEY]: 'r-1' });
    const notice = takeHostingNotice(store);
    assert.ok(notice !== undefined, 'a reloaded host tab was told nothing');
    assert.match(notice, /hosting a room/);
    assert.match(notice, /reloading ended it/i);
    assert.match(notice, /nothing in it was written to the folder/);
    // Taken, not repeated: the card goes back to being a card.
    assert.equal(takeHostingNotice(store), undefined);
    assert.deepEqual(store.all(), {});
  });

  it('clears the mark when the room ends cleanly, and says nothing next load', () => {
    const store = storage();
    markHosting(store, 'r-1');
    clearHostingMark(store);
    assert.equal(takeHostingNotice(store), undefined);
  });

  it('is silent where the tab has no storage to read', () => {
    const refused = storage({}, true);
    assert.equal(takeHostingNotice(refused), undefined);
    // Storing and clearing a mark that cannot be stored is not a failure of the room.
    markHosting(refused, 'r-1');
    clearHostingMark(refused);
  });

  it('a bare page load with no mark says nothing, whatever storage holds', () => {
    assert.equal(takeHostingNotice(storage({ 'selvage.displayName': 'Ada' })), undefined);
  });
});
