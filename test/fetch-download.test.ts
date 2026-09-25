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
  canSaveAtOnce,
  documentToAutoOpen,
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

  it('is not saved while what it holds is nothing', async () => {
    // The room answers a fetch that timed out by holding an empty document for the path, and the
    // path then reads as held. Saving that is the same empty file by another door: the person is
    // offered the choice instead.
    const arrivedEmpty = room('');
    arrivedEmpty.deliver();
    const outcome = await fetchAndSave('src/main.ts', arrivedEmpty.ports, { wait: arrivedEmpty.wait });
    assert.equal(outcome.kind, 'empty');
    assert.deepEqual(arrivedEmpty.saved, [], 'a held-but-empty path was saved without being asked');
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
    assert.match(stillAskingSentence('src/main.rs'), /^Still asking the host for src\/main\.rs — no answer yet\.$/);
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
      /^src\/main\.rs is still empty — the host sent no text for it\.$/,
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

  it('gives the path this window holds an empty document for the choice, not a save', async () => {
    // The other door to the same empty file: a document for the path is here and its text is
    // nothing. That is the room's answer, so it is offered — never assumed.
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

  it('never saves an empty answer at once, however the room reports the path', () => {
    // A document with no text in it is the room's answer that the file it read is empty, and the
    // answer is offered by name rather than written: an empty file under the name the person asked
    // for is theirs to choose. The driver caught the page saving one unasked.
    assert.equal(canSaveAtOnce(''), false, 'an empty answer was saved without being asked for');
    assert.equal(canSaveAtOnce('\n'), true, 'a file of one newline is text');
    assert.equal(canSaveAtOnce('fn main() {}'), true);
    const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
    assert.match(main, /if \(canSaveAtOnce\(text\)\)/, 'the page saves on the document again');
    assert.ok(
      !/if \(binding\.hasText\(path\)\)/.test(main),
      'a path the room merely holds is saved as if its text were here',
    );
  });
});

describe('what the fetch must not do', () => {
  it('does not put the file it fetched in front of the editor', () => {
    // A fetch is a background act: it is what puts a path in the room's open set, and the page's own
    // rule — nothing is open here, so open the first document the room names — would otherwise switch
    // the editor to the file the person only asked to save. The in-room driver caught exactly this.
    const background = new Set(['src/main.rs']);
    assert.equal(documentToAutoOpen(['src/main.rs'], undefined, background), undefined);
    // A document that is in the room for somebody else's reason is still opened.
    assert.equal(documentToAutoOpen(['README.md', 'src/main.rs'], undefined, background), 'README.md');
    // And a window that already has a file open is left alone, whatever arrived.
    assert.equal(documentToAutoOpen(['README.md'], 'notes.md', background), undefined);
    // The page names every path it fetches, so this is the whole of the rule.
    assert.match(
      readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8'),
      /backgroundFetches\.add\(candidate\)/,
      'the page fetches without naming what it fetched',
    );
  });
});

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
