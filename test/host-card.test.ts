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
  HOST_SHARE_NOTE,
  HOST_TAB_WARNING,
  HOST_UNREAD_NOTE,
  clearHostingMark,
  hostAvailability,
  hostUnreadNote,
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

  it('asks for a folder in three words, and says what the folder gives away before the click', () => {
    // The ellipsis is the platform's own convention for "this opens a picker".
    assert.match(html, /Share a folder\u2026/, 'the button does not say what it does');
    assert.match(main, /HOST_BUTTON_LABEL = 'Share a folder\u2026'/, 'the label the bundle puts back differs from the shell');
    assert.ok(!html.includes('Choose a folder'), 'the long label survives in the shell');
    // The card carried a paragraph under the button saying what a guest gets — the names in the
    // folder, and a file's text only when it is opened. The grant already defines the listing
    // (`DESIGN.md` §4.2), so the paragraph was cut — and the cut left the card saying nothing about
    // the one thing the person granting is the only one who can act on, and only before the click:
    // anyone with the invite link can open and edit the files this page shares, and an edit that
    // settles is written into the file on disk. Two sentences, one job each.
    assert.equal(
      HOST_SHARE_NOTE,
      'Anyone with the invite link can open and edit the files this page shares. Edits are written back to those files on disk.',
    );
    assert.match(HOST_SHARE_NOTE, /^Anyone with the invite link can open and edit the files/);
    assert.match(HOST_SHARE_NOTE, /Edits are written back to those files on disk\.$/);
    // It does not claim every path in the folder: the grant excludes `.env`, `.git/**` and the key
    // names, and a binary-named or oversize file never reaches the listing (`folder.ts`).
    assert.ok(!/every file/i.test(HOST_SHARE_NOTE), 'the card claims the whole folder is shared');
    assert.ok(!/nothing is saved|not saved/i.test(HOST_SHARE_NOTE), 'the card denies the write-back again');
    // It is on the card, under the button it is about, and the bundle is what writes it.
    const wrap = sliceBetween(html, '<div id="host-wrap"', '</div>');
    const button = wrap.indexOf('id="host-button"');
    const share = wrap.indexOf('id="host-share"');
    assert.ok(share !== -1, 'the card has no line for what the folder gives away');
    assert.ok(button !== -1 && button < share, 'the note about the folder is not under the button that asks for it');
    assert.match(main, /hostShare\.textContent = offered \? HOST_SHARE_NOTE : ''/, 'the line is never written with the offer');
    assert.ok(!main.includes('HOST_GUESTS_NOTE'), 'the old guests note survives in the bundle');
  });

  it("says hosting in one quiet line on a guest's card, and the one sentence it costs on the start card", () => {
    // Design §7.1: a guest arrived for the join, so hosting is one quiet line — pressing it is
    // what puts the start card, the sentence and the picker in front of them — and the cost of the
    // room is read where the decision to host is made.
    assert.match(html, /<button id="host-quiet" type="button" hidden>Or start your own session<\/button>/,
      'the guest card carries no quiet line');
    const showing = sliceBetween(main, 'function showHosting', 'hostQuiet.addEventListener');
    assert.match(showing, /if \(cardIntent === 'join'\)/, 'the two intents are said the same way');
    assert.match(showing, /hostQuiet\.hidden = !offered/, 'the quiet line stands where hosting is not offered');
    assert.match(showing, /hostButton\.hidden = true/, 'the start button still stands on a guest card');
    assert.match(showing, /hostNote\.textContent = offered \? '' : availability\.note/,
      'a guest is read the sentence about a room the card has not offered to make a host');
    // And the sentence is the start card's own, once.
    assert.match(showing, /hostNote\.textContent = availability\.note;/, 'the start card says nothing about what the room costs');
    // One sentence, and it is the facts the person cannot see for themselves: the room and its
    // invite link go with the tab, and only what has not settled yet is at risk — every settled edit
    // is already in the folder, which is what the sentence before this one made the page do. That
    // the tab is the host is what the press already said, the countdown is the room's own grace and
    // to be read where it runs, and a number in it would go stale.
    assert.match(HOST_TAB_WARNING, /^Closing or reloading this tab ends the room/, 'the sentence names some other cost');
    assert.match(HOST_TAB_WARNING, /the invite link stops working/, 'the sentence does not say the link dies with the room');
    assert.match(HOST_TAB_WARNING, /last keystrokes may not reach your folder/, 'the sentence does not say what is at risk');
    assert.ok(!/nothing in it is saved|not saved/i.test(HOST_TAB_WARNING), `the sentence still denies the write-back: ${HOST_TAB_WARNING}`);
    assert.ok(!/\.\s/.test(HOST_TAB_WARNING), `the card is a paragraph again: ${HOST_TAB_WARNING}`);
    assert.ok(!/\bhost\b/i.test(HOST_TAB_WARNING), `the sentence tells a host that it is hosting: ${HOST_TAB_WARNING}`);
    assert.ok(!/\bcountdown\b|\bseconds?\b|\bminutes?\b/i.test(HOST_TAB_WARNING), `the sentence carries a number that goes stale: ${HOST_TAB_WARNING}`);
    assert.ok(!/hostWarningFor/.test(main), 'the scoped warning survived the collapse');
  });

  it('puts the start card in front of the person when the quiet line is pressed', () => {
    const swap = sliceBetween(main, 'function swapCardToStart', 'hostQuiet.addEventListener');
    assert.match(swap, /cardIntent = 'start'/, 'the card keeps the join intent it swapped away from');
    assert.match(swap, /showCardIntent\(cardElements\(\), 'start'\)/, 'the card is never repainted in the start intent');
    // The join intent opened the invite path itself, so the swap shuts it: the card is the start
    // variant, and the disclosure is the way back to the link the address bar still carries.
    assert.match(swap, /invitePath\.open = false/, 'the swap leaves the guest’s join box open');
    // The name is one field either way, so nothing typed is lost.
    assert.ok(!/nameInput\.value =/.test(swap), 'the swap clears the name the person typed');
    // The press hid the control it was made with, so focus goes with it: a keyboard left on a
    // hidden element has nowhere to be.
    assert.match(
      swap,
      /\(hostButton\.hidden \? nameInput : hostButton\)\.focus\(\)/,
      'the swap hides the control that was pressed and leaves focus on it',
    );
  });
});

describe('whether the card offers to start a room', () => {
  /** What a Selvage server answers, which is what the card is offered under. */
  const sealedMeta: Meta = { wire_versions: ['selvage/2'] };
  /** What a `/meta` read said, in the three shapes the card has to tell apart. */
  const server = (meta: Meta): ServerRead => ({ kind: 'server', meta });

  it('offers it only where a folder can be picked and the page is the server', () => {
    assert.deepEqual(hostAvailability({ picker: true, read: server(sealedMeta) }), {
      kind: 'offered',
      note: HOST_TAB_WARNING,
    });
    // One wording, whichever card is asking: a guest's card writes the sentence nowhere, and the
    // start card that pressing its quiet line brings up is the only place it stands (`showHosting`).
    assert.equal(hostAvailability({ picker: true, read: server(sealedMeta) }).note, HOST_TAB_WARNING);
  });

  it('explains a browser that cannot hand over a folder, and says joining still works', () => {
    const availability = hostAvailability({ picker: false, read: server(sealedMeta) });
    assert.equal(availability.note, HOST_NEEDS_A_BROWSER);
    assert.equal(availability.kind, 'explained');
    assert.match(HOST_NEEDS_A_BROWSER, /Joining a room here still works/);
  });

  it("explains a page that is not the server's own page rather than guessing at one", () => {
    const availability = hostAvailability({ picker: true, read: { kind: 'not-a-server' } });
    assert.deepEqual(availability, { kind: 'explained', note: HOST_NEEDS_THE_SERVERS_PAGE });
    // A picker that cannot pick is the first answer either way: the /meta read is not worth
    // making where there is nothing to do with its answer.
    assert.equal(
      hostAvailability({ picker: false, read: { kind: 'not-a-server' } }).kind,
      'explained',
    );
  });

  it('keeps the offer where /meta did not answer, and never calls the page someone else\'s', () => {
    // M1: `/meta` is advisory (§2), so a deadline that passed is not an answer about this
    // origin. The offer stands with a note that says what was not read — the sentence for a
    // page that is not a Selvage server's is the one answer that would be untrue here.
    const availability = hostAvailability({ picker: true, read: { kind: 'no-answer' } });
    assert.equal(availability.kind, 'unchecked');
    assert.equal(availability.note, HOST_UNREAD_NOTE);
    // The note has one wording, whatever card it would stand on: `hostUnreadNote` is the same
    // wording the constant carries, so the two cannot drift into two answers.
    assert.equal(hostUnreadNote(), HOST_UNREAD_NOTE);
    assert.ok(
      !availability.note.includes(HOST_NEEDS_THE_SERVERS_PAGE),
      'a read that did not answer still says the page was not served by a Selvage server',
    );
    assert.match(availability.note, /has not answered \/meta/);
    // A body that answered and is a Selvage server's is the offer, whatever it seats: there is
    // no version to decide and no control whose only outcome is a refusal.
    assert.deepEqual(hostAvailability({ picker: true, read: server(sealedMeta) }), {
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

  it('draws the line and the note from the availability it just made', () => {
    assert.match(main, /hostNote\.textContent = availability\.note/, 'the note is not what is written');
    assert.match(
      main,
      /const offered = availability\.kind !== 'explained'/,
      'nothing tells a sentence from an action',
    );
    assert.match(main, /hostButton\.hidden = !offered/, 'a button is shown where only a sentence belongs');
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
    // The refusal the card words itself is unchanged, and it goes to the field it is about: the
    // name the card needs stands at the name, not under the button that asked.
    assert.ok(
      attempt.includes('showNameFailure(nameField, describe(error))'),
      'a refused name no longer reaches its own field',
    );
    // And what that mapper does with the engine's message is the plain sentence.
    assert.equal(
      describeJoinError(new Error('the WebSocket reported an error'), 'ws://127.0.0.1:9'),
      "Couldn\u2019t reach the session. Check your connection and retry.",
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
    // One sentence, and only what this reader can act on: what the reload cost, and the one act
    // that starts another. The page-hosted shape is what they just reloaded, and the guests'
    // countdown belongs to the room they are no longer in.
    assert.match(notice, /^Reloading ended the room this tab was hosting/);
    assert.match(notice, /the invite link is dead/);
    assert.match(notice, /everything settled is already in your folder/);
    assert.ok(!/nothing in it was saved|not saved/i.test(notice), `the card still denies the write-back: ${notice}`);
    assert.match(notice, /pick the folder again to start another/i);
    assert.ok(!/\.\s/.test(notice), `the card is a paragraph again: ${notice}`);
    assert.ok(!/\bcountdown\b|\bgrace\b/i.test(notice), `the reloaded host is told about a room they left: ${notice}`);
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
