/**
 * Saving a room path this window has no text for yet.
 *
 * The defect this suite exists for is a data defect and not a UI gap: a download that saves
 * `text(path)` before the room has answered writes an empty file under the right name, and nothing
 * about that file says it is wrong. So the assertions here are the halves of the fix — the save
 * happens only once text has arrived here, and it saves the text that arrived and not the empty
 * string that was there first — and the one that keeps them honest: nothing arriving is not the
 * same state as the room answering with an empty document, and the page says the wait instead of
 * claiming the room said the file is empty.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FETCH_SETTLE_MS,
  FETCH_STAND_MS,
  fetchAndSave,
  fetchCostsSentence,
  fetchFailedSentence,
  fetchingSentence,
  fetchStandMs,
  stillAskingSentence,
  stillEmptySentence,
} from '../src/browser/fetch-download.ts';
import type { FetchSavePorts } from '../src/browser/fetch-download.ts';

/** A room whose answer arrives after `after` polls, the way a real one does over a socket. */
function room(
  text: string,
  { after = 0, fail, present: startsPresent = false }: { after?: number; fail?: string; present?: boolean } = {},
) {
  const saved: Array<[string, string]> = [];
  const polls: number[] = [];
  let present = startsPresent;
  let left = after;
  const ports: FetchSavePorts = {
    has: () => present,
    text: () => (present ? text : ''),
    open: async () => {
      if (fail !== undefined) {
        throw new Error(fail);
      }
      // The room is asked; the answer lands a few turns later.
    },
    save: (path, value) => void saved.push([path, value]),
  };
  return {
    ports,
    saved,
    polls,
    /** The room answers now, which is what a setup does when it does not want to count a poll. */
    deliver() {
      present = true;
    },
    /** One turn of the wait: the room answers when its own count is up. */
    async wait(ms: number) {
      polls.push(ms);
      if (left > 0) {
        left -= 1;
      } else {
        present = true;
      }
    },
  };
}

describe('a path this window already holds', () => {
  it('is saved at once, with no fetch and no message', async () => {
    const held = room('let a = 1;\n');
    held.deliver();
    const outcome = await fetchAndSave('src/main.ts', held.ports, { wait: held.wait });
    assert.deepEqual(outcome, { kind: 'saved', text: 'let a = 1;\n' });
    assert.deepEqual(held.saved, [['src/main.ts', 'let a = 1;\n']]);
    assert.deepEqual(held.polls, [], 'a file this window holds was fetched again');
  });

  it('is saved as it stands when what it holds is nothing, and is never said to be the host’s empty one', async () => {
    // The person's own emptied file, in front of the editor or behind it: it is saved under its own
    // name with nothing in it, and the row says nothing about the host. What the page used to do
    // instead — read the empty copy as the room's answer — told somebody who had cleared a file
    // themselves, and then switched to another one, that `notes.md is still empty — the host sent no
    // text for it`, and offered to save the empty file they had already asked for.
    const emptied = room('');
    emptied.deliver();
    const outcome = await fetchAndSave('notes.md', emptied.ports, { wait: emptied.wait });
    assert.notEqual(outcome.kind, 'empty', 'the person’s own emptied file was said to be the host’s');
    assert.deepEqual(outcome, { kind: 'saved', text: '' });
    assert.deepEqual(emptied.saved, [['notes.md', '']], 'the empty file the person asked for was not saved');
    assert.deepEqual(emptied.polls, [], 'a path this window holds was fetched again');
  });
});

describe('a path whose text has not been fetched', () => {
  it('waits for the room and saves the text that arrived, never the empty string', async () => {
    // The heart of it. `text(path)` answers '' the whole time the room is being asked, so a page
    // that saved what it read would hand the person an empty file named `src/main.ts` — with nothing
    // in it to say the real contents were still on their way.
    const arriving = room('fn main() {}\n', { after: 3 });
    const outcome = await fetchAndSave('src/main.rs', arriving.ports, {
      wait: arriving.wait,
      polls: 10,
    });
    assert.deepEqual(outcome, { kind: 'saved', text: 'fn main() {}\n' });
    assert.deepEqual(arriving.saved, [['src/main.rs', 'fn main() {}\n']]);
    assert.equal(arriving.saved.some(([, text]) => text === ''), false, 'an empty file was saved');
    // It really did wait: nothing was saved until the room answered.
    assert.ok(arriving.polls.length >= 3, `the fetch did not wait: ${arriving.polls.length} polls`);
  });

  it('saves the text of an answer that takes turns to land, never the empty string', async () => {
    // The answer and its text are the same document, so what the loop reads for is text: this room's
    // answer arrives a few turns after the ask, and the fetch saves what it carries rather than the
    // empty string it read before the answer was here.
    const answering = room('fn main() {}\n', { after: 0 });
    // A path this window holds a document for, with its text already here.
    answering.deliver();
    const late = room('fn main() {}\n', { after: 3, present: false });
    const outcome = await fetchAndSave('src/main.rs', late.ports, { wait: late.wait, polls: 10 });
    assert.deepEqual(outcome, { kind: 'saved', text: 'fn main() {}\n' });
    assert.deepEqual(late.saved, [['src/main.rs', 'fn main() {}\n']]);
    assert.equal(answering.ports.has('x'), true);
  });

  it('fetches a document that is open in front of the editor and not yet answered', async () => {
    // The blocking defect. A guest taps the row's ⤓ on the file it has just opened, before the room
    // has sent its text: the model behind the editor is empty, and the row saved *that* — a 0-byte
    // file named after the one the person asked for, with nothing to say it was wrong. An open
    // document is not an answered one, so this is a fetch: it waits, and it saves what arrived.
    const opened = room('fn main() {}\n', { after: 2 });
    const outcome = await fetchAndSave('notes.md', opened.ports, { wait: opened.wait, polls: 5 });
    assert.deepEqual(outcome, { kind: 'saved', text: 'fn main() {}\n' });
    assert.deepEqual(opened.saved, [['notes.md', 'fn main() {}\n']]);
    assert.equal(opened.saved.some(([, text]) => text === ''), false, 'the open model was saved as the file');
    assert.ok(opened.polls.length >= 2, `the fetch did not wait for the room: ${opened.polls.length} polls`);
  });

  it('never says a room that has not answered is empty', async () => {
    // The two states share one text — `''` — and differ in whether anything arrived at all. The
    // room answered with an empty document in one, and said nothing in the other; the page cannot
    // read a file out of silence, and saying it is empty is stating a fact it does not have.
    const silent = room('', { after: 99 });
    const outcome = await fetchAndSave('src/main.rs', silent.ports, {
      wait: silent.wait,
      polls: 5,
    });
    assert.equal(outcome.kind, 'pending');
    assert.notEqual(outcome.kind, 'empty', 'silence was reported as the room’s empty answer');
    assert.deepEqual(silent.saved, [], 'a fetch that never landed saved something');
    assert.match(stillAskingSentence('src/main.rs'), /^Still asking the host for src\/main\.rs\. No answer yet\.$/);
    assert.doesNotMatch(stillAskingSentence('src/main.rs'), /empty/i, 'the wait was said as emptiness');
    // The room's own empty answer is the other state, and it is the one `Save empty file` is for.
    const answered = room('', { after: 0 });
    const empty = await fetchAndSave('src/main.rs', answered.ports, {
      wait: answered.wait,
      polls: 3,
    });
    assert.equal(empty.kind, 'empty');
    assert.match(
      stillEmptySentence('src/main.rs'),
      /^src\/main\.rs is still empty\. The host sent no text for it\.$/,
    );
  });

  it('gives the room a stand derived from the server’s own renewal window', () => {
    // `§7.1` answers an announcement folded into a window at that window's end, so the stand is
    // measured in windows and the page reads the server's number rather than assuming one. The
    // page must wait at least the whole window a fold can cost.
    assert.equal(fetchStandMs(15_000), 15_000 + FETCH_SETTLE_MS);
    assert.ok(fetchStandMs(15_000) > 15_000, 'the stand is shorter than one fold');
    assert.equal(fetchStandMs(30_000), 30_000 + FETCH_SETTLE_MS);
    // With no seated session to read it from, the page falls back to its own number rather than
    // standing for ever or for nothing.
    assert.equal(fetchStandMs(undefined), FETCH_STAND_MS);
    // And the call site reads the session's number and hands it in.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /standMs: fetchStandMs\(awarenessRenewMs\(\)\)/, 'the page does not read the window');
    assert.match(main, /keepalive\.awareness_renew_ms/, 'the stand is not the server’s own number');
  });

  it('offers nothing that claims emptiness while the request is still in flight', () => {
    // A `pending` fetch is a wait, and the only thing a person can do about it is ask again: a
    // `Save empty file` beside it would be the page saving a file out of a silence it cannot read.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    const pending = /if \(outcome\.kind === 'pending'\) \{([\s\S]*?)\n      \}/.exec(main);
    assert.notEqual(pending, null, 'the page no longer tells a pending fetch from an empty answer');
    const branch = pending === null ? '' : pending[1];
    assert.match(branch, /stillAskingSentence\(path\)/);
    assert.doesNotMatch(branch, /Save empty file/, 'an unanswered fetch offers an empty file');
    assert.doesNotMatch(branch, /stillEmptySentence/, 'an unanswered fetch is said as emptiness');
  });

  it('stops at the room’s answer, whether or not that answer carries text', async () => {
    // The answer and the text it carries are one arrival: the room sends one document for the path,
    // and an empty document is its answer that the file it read is empty. A loop that reads on for
    // text past that document waits for a second thing this protocol never sends — against a real
    // `selvaged` the answer landed 101 ms after the ask and the fetch reported it at 3 007 ms, the
    // whole stand, with `Asking the host for …` standing on the screen for all of it.
    const answered = room('', { after: 0 });
    const outcome = await fetchAndSave('empty.txt', answered.ports, {
      wait: answered.wait,
      polls: 5,
    });
    assert.equal(outcome.kind, 'empty');
    assert.deepEqual(answered.saved, [], 'an empty answer was saved without being asked for');
    assert.equal(
      answered.polls.length,
      1,
      `the fetch waited past the answer: ${answered.polls.length} polls of a 5-poll stand`,
    );
  });

  it('offers an empty answer that arrives inside the fetch, rather than writing it', async () => {
    // The other door to the same empty file, and the one `Save empty file` is for: nothing was here
    // when the person asked, and the room's answer is a document with no text in it. That is news —
    // the person asked for a file they thought had contents — so it is offered. A copy this window
    // already *holds* when it asks never reaches here; it is saved as it stands.
    const empty = room('', { after: 0 });
    const outcome = await fetchAndSave('notes.md', empty.ports, { wait: empty.wait, polls: 3 });
    assert.equal(outcome.kind, 'empty');
    assert.deepEqual(empty.saved, [], 'an empty file was saved without being asked for');
  });

  it('saves nothing when nothing arrives at all', async () => {
    const silent = room('fn main() {}\n', { after: 99 });
    const outcome = await fetchAndSave('src/main.rs', silent.ports, { wait: silent.wait, polls: 4 });
    assert.equal(outcome.kind, 'pending');
    assert.deepEqual(silent.saved, [], 'a fetch that never landed saved something');
  });

  it('reports a fetch the room would not take, and saves nothing', async () => {
    const refusing = room('', { fail: 'the room closed' });
    const outcome = await fetchAndSave('notes.md', refusing.ports, { wait: refusing.wait, polls: 3 });
    assert.equal(outcome.kind, 'failed');
    assert.match(
      outcome.kind === 'failed' ? outcome.sentence : '',
      /^Could not download notes\.md: the room closed$/,
    );
    assert.deepEqual(refusing.saved, []);
  });

  it('asks the room whether it has answered, and never whether the file is open here', () => {
    // What the page reads for its decision. It is the room's answer that decides — the presence of a
    // document for the path — and the document in front of the editor is not that answer. The two
    // were once the same test (`openHere || canSaveAtOnce(text)`), which is what made the blocking
    // defect: `openHere` was true while the text was still coming, and the empty model was saved.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    const download = sliceBetween(main, 'function startDownload', '/** Where a download goes');
    assert.match(download, /const holds = binding\.hasText\(path\) === true;/, 'the page no longer reads the room’s receipt');
    assert.doesNotMatch(
      download,
      /currentPath\(\)/,
      'the document in front of the editor stands for the room\u2019s answer again',
    );
  });

  it('says what a fetch costs only when a fetch is what comes next', () => {
    // `Fetching opens …` is about an act: a path this window holds is answered out of its own
    // document, with no open behind it, so the sentence would describe a fetch that never happens.
    // It stood over the open file — a file this window plainly has — as well.
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    const download = sliceBetween(main, 'function startDownload', '/** Where a download goes');
    assert.match(
      download,
      /if \(!holds && !saidFetchCosts\) \{/,
      'the cost of a fetch stands over a path no fetch is made for',
    );
    assert.match(download, /if \(!holds\) \{\n    feedback\.busy\(fetchingSentence\(path\)\);/, 'the wait is shown for a save');
  });
});

describe('what the fetch must not do', () => {
  it('never opens anything, and never moves the editor', () => {
    // A fetch is a background act: it is what puts a path in the room's open set, and the page used
    // to answer a changed set by opening the first document the room named. On a phone that is the
    // defect the in-room driver photographed: a guest downloads a file it has never opened, the
    // room's set moves, a *different* document opens, the panel collapses, and the row the person
    // acted on — with its note and its actions — is inside the closed panel. Opening a file is the
    // person's act; the one open the page makes for them is the room's own seat (`openFirst`).
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    const documents = sliceBetween(main, "case 'documents':", "case 'peers':");
    assert.ok(!/openPath\(/.test(documents), 'the room\u2019s set still opens a document by itself');
    assert.ok(!/documentToAutoOpen/.test(main), 'the auto-open rule survives in the page');
    assert.ok(!/backgroundFetches/.test(main), 'the page still names what it fetched behind the editor');
    // And the fetch itself still asks without opening: `requestText` is the engine's open, which is
    // what makes the room send the text, and it builds no model and touches no editor.
    const download = sliceBetween(main, 'function startDownload', '/** Where a download goes');
    assert.match(download, /binding\?\.requestText\(candidate\)/, 'the fetch stopped asking the room');
  });
});

/** The slice of a source file between two markers, both of which have to be there. */
function sliceBetween(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  assert.ok(start !== -1, `no ${from} in the source`);
  const end = text.indexOf(to, start);
  assert.ok(end !== -1, `no ${to} after ${from} in the source`);
  return text.slice(start, end);
}

describe('what the row says', () => {
  it('names the file while it waits, and names what opening it costs the room, once', () => {
    assert.equal(fetchingSentence('src/main.rs'), 'Asking the host for src/main.rs…');
    assert.equal(
      fetchCostsSentence('src/main.rs'),
      'Fetching opens src/main.rs in the room, so every peer receives it.',
    );
  });

  it('reports a failure beside the row, in the page’s own words for a download', () => {
    assert.equal(
      fetchFailedSentence('src/main.rs', 'the socket is down'),
      'Could not download src/main.rs: the socket is down',
    );
  });
});
