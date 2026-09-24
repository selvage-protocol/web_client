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
  HOST_GUESTS_NOTE,
  HOST_MARK_KEY,
  HOST_NEEDS_A_BROWSER,
  HOST_NEEDS_THE_SERVERS_PAGE,
  HOST_TAB_WARNING,
  HOST_UNREAD_NOTE,
  clearHostingMark,
  hostAvailability,
  hostUnreadNote,
  hostWarningFor,
  markHosting,
  takeHostingNotice,
} from '../src/browser/host.ts';
import { META_REREAD_TIMEOUT_MS } from '../src/browser/meta-read.ts';
import type { ServerRead } from '../src/browser/meta-read.ts';
import { describeJoinError } from '../src/browser/transport.ts';
import type { HostStorage } from '../src/browser/host.ts';
import type { Meta } from '../src/engine/index.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

/** The slice of a source file between two markers, both of which have to be there. */
function sliceBetween(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  assert.ok(start !== -1, `no ${from} in the source`);
  const end = text.indexOf(to, start);
  assert.ok(end !== -1, `no ${to} after ${from} in the source`);
  return text.slice(start, end);
}

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

  it('asks for a folder by name, and says what a guest gets', () => {
    assert.match(html, /Choose a folder to share/, 'the button does not say what it does');
    // The button asks for a folder; the line under it says what sharing one means, so the
    // warning about the tab is not the only thing the card says about the room.
    assert.match(main, /HOST_BUTTON_LABEL = 'Choose a folder to share'/, 'the label the bundle puts back differs from the shell');
    assert.match(HOST_GUESTS_NOTE, /file names/i, 'the card never says what a guest sees');
    assert.match(HOST_GUESTS_NOTE, /only when someone opens it/i, 'the card implies the text is sent up front');
    assert.match(main, /HOST_GUESTS_NOTE/, 'the sentence is not the one the card writes');
    assert.match(main, /hostShare\.textContent = availability\.kind === 'explained' \? '' : HOST_GUESTS_NOTE/);
  });

  it("scopes the tab warning to the start action on a guest's card", () => {
    // A guest who followed a link read "This tab is the host. Close or reload it and the room
    // ends..." under the join, as if it were about the room they just entered. On that card the
    // start action is the alternative under Join, and the warning says so.
    assert.match(hostWarningFor('start'), /^This tab is the host/);
    assert.match(hostWarningFor('join'), /^If you start your own session instead, this tab is the host/);
  });
});

describe('whether the card offers to start a room', () => {
  /** What a Selvage server answers, which is what the card is offered under. */
  const sealedMeta: Meta = { wire_versions: ['selvage/2'] };
  /** What a `/meta` read said, in the three shapes the card has to tell apart. */
  const server = (meta: Meta): ServerRead => ({ kind: 'server', meta });

  it('offers it only where a folder can be picked and the page is the server', () => {
    assert.deepEqual(hostAvailability({ picker: true, read: server(sealedMeta), scope: 'start' }), {
      kind: 'offered',
      note: HOST_TAB_WARNING,
    });
    // The same offer on a guest's card carries the warning that names the action it belongs to.
    assert.deepEqual(hostAvailability({ picker: true, read: server(sealedMeta), scope: 'join' }), {
      kind: 'offered',
      note: hostWarningFor('join'),
    });
  });

  it('explains a browser that cannot hand over a folder, and says joining still works', () => {
    const availability = hostAvailability({ picker: false, read: server(sealedMeta), scope: 'start' });
    assert.equal(availability.note, HOST_NEEDS_A_BROWSER);
    assert.equal(availability.kind, 'explained');
    assert.match(HOST_NEEDS_A_BROWSER, /Joining a room here still works/);
  });

  it("explains a page that is not the server's own page rather than guessing at one", () => {
    const availability = hostAvailability({ picker: true, read: { kind: 'not-a-server' }, scope: 'start' });
    assert.deepEqual(availability, { kind: 'explained', note: HOST_NEEDS_THE_SERVERS_PAGE });
    // A picker that cannot pick is the first answer either way: the /meta read is not worth
    // making where there is nothing to do with its answer.
    assert.equal(
      hostAvailability({ picker: false, read: { kind: 'not-a-server' }, scope: 'start' }).kind,
      'explained',
    );
  });

  it('keeps the offer where /meta did not answer, and never calls the page someone else\'s', () => {
    // M1: `/meta` is advisory (§2), so a deadline that passed is not an answer about this
    // origin. The offer stands with a note that says what was not read — the sentence for a
    // page that is not a Selvage server's is the one answer that would be untrue here.
    const availability = hostAvailability({ picker: true, read: { kind: 'no-answer' }, scope: 'start' });
    assert.equal(availability.kind, 'unchecked');
    assert.equal(availability.note, HOST_UNREAD_NOTE);
    // On a guest's card the same note carries the scoped warning, so its own opening sentence
    // stands unchanged and only the warning under it names the action it belongs to.
    assert.equal(
      hostAvailability({ picker: true, read: { kind: 'no-answer' }, scope: 'join' }).note,
      hostUnreadNote('join'),
    );
    assert.ok(
      !availability.note.includes(HOST_NEEDS_THE_SERVERS_PAGE),
      'a read that did not answer still says the page was not served by a Selvage server',
    );
    assert.match(availability.note, /has not answered \/meta/);
    // A body that answered and is a Selvage server's is the offer, whatever it seats: there is
    // no version to decide and no control whose only outcome is a refusal.
    assert.deepEqual(hostAvailability({ picker: true, read: server(sealedMeta), scope: 'start' }), {
      kind: 'offered',
      note: HOST_TAB_WARNING,
    });
  });
});

describe('the card reads its own origin, and keeps the offer for an answer it did not get', () => {
  it('asks with the reader that tells no answer from an answer', () => {
    // `readServerMeta` (`meta-read.ts`) is the one read the offer rests on: a response that
    // arrived is an answer about this origin whatever it was, and a deadline that passed is not.
    // The offer has no second question behind it — there is one wire and this page speaks it — so
    // nothing else stands between a `file://` open and a real answer.
    const offering = sliceBetween(main, 'async function offerHosting', 'function showHosting');
    assert.match(offering, /readServerMeta\(base\)/, 'the card does not read its own origin');
  });

  it('looks a second time with a longer deadline, and only a real answer changes the card', () => {
    // A server that was cold, a link that stalled, a proxy that hiccupped: the first ask says
    // nothing, the offer stands with the note that says so, and one more ask replaces that note
    // with the truth if there is one. Only a read that answered can redraw the card.
    const offering = sliceBetween(main, 'async function offerHosting', 'function showHosting');
    assert.match(offering, /read\.kind !== 'no-answer'[\s\S]{0,80}return/, 'every read redraws the card');
    assert.match(
      offering,
      /readServerMeta\(base, \{ timeoutMs: META_REREAD_TIMEOUT_MS \}\)/,
      'the second ask has no longer deadline than the first',
    );
    assert.match(
      offering,
      /again\.kind !== 'no-answer' && !hosting/,
      'a second read that did not answer, or a picker mid-flight, still redraws the card',
    );
    assert.ok(META_REREAD_TIMEOUT_MS > 2000, 'the second ask is no longer than the first');
  });

  it('draws the button and the note from the availability it just made', () => {
    assert.match(main, /hostNote\.textContent = availability\.note/, 'the note is not what is written');
    assert.match(
      main,
      /hostButton\.hidden = availability\.kind === 'explained'/,
      'a button is shown where only a sentence belongs, or the other way round',
    );
  });

  it("shows the card's own copy for a failed host, not the socket's", () => {
    // The join path maps every transport failure to plain copy (`transport.ts`); the host path
    // showed the engine's message instead ("the WebSocket reported an error"). Both go through
    // the one mapper now, and the card's own refusals pass through it untouched.
    const attempt = sliceBetween(main, 'async function attemptHost', 'async function offerHosting');
    assert.match(
      attempt,
      /hostError\.textContent = describeJoinErrorForDisplay\(error, base/,
      'a failed host still puts the engine\'s own wording on the card',
    );
    assert.ok(
      attempt.includes('joinFailureDetail(error, base)'),
      'the diagnostic no longer names the server in the console',
    );
    // The refusal the card words itself is unchanged: the name it needs is still its own line.
    assert.ok(
      attempt.includes('hostError.textContent = describe(error)'),
      'a refused name no longer reaches its own line',
    );
    // And what that mapper does with the engine's message is the plain sentence.
    assert.equal(
      describeJoinError(new Error('the WebSocket reported an error'), 'ws://127.0.0.1:9'),
      "Couldn't reach the session. Check your connection and retry.",
    );
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
