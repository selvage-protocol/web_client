/**
 * Saving a room path this window has no text for yet.
 *
 * The defect this suite exists for is a data defect and not a UI gap: a download that saves
 * `text(path)` before the room has answered writes an empty file under the right name, and nothing
 * about that file says it is wrong. So the two things asserted here are the two halves of the fix —
 * the save happens only once the room has the path, and it saves the text that arrived and not the
 * empty string that was there first — and the third is that a fetch which never lands saves nothing
 * at all and offers the choice instead.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FETCH_STAND_MS,
  fetchAndSave,
  fetchCostsSentence,
  fetchFailedSentence,
  fetchingSentence,
  stillEmptySentence,
} from '../src/browser/fetch-download.ts';
import type { FetchSavePorts } from '../src/browser/fetch-download.ts';

/** A room whose answer arrives after `after` polls, the way a real one does over a socket. */
function room(text: string, { after = 0, fail }: { after?: number; fail?: string } = {}) {
  const saved: Array<[string, string]> = [];
  const polls: number[] = [];
  let present = false;
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

  it('saves nothing when the room never answers, and says what the text is not', async () => {
    const silent = room('', { after: 99 });
    const outcome = await fetchAndSave('src/main.rs', silent.ports, {
      wait: silent.wait,
      polls: 5,
    });
    assert.equal(outcome.kind, 'empty');
    assert.deepEqual(silent.saved, [], 'a fetch that never landed saved something');
    assert.equal(stillEmptySentence('src/main.rs'), 'src/main.rs is still empty — the host has not sent its text yet.');
  });

  it('saves nothing when the room answers empty, and leaves the choice to the person', async () => {
    // An empty file is a state a person may want, so it is offered — but it is not what they asked
    // for, so it is not assumed.
    const empty = room('', { after: 0 });
    const outcome = await fetchAndSave('notes.md', empty.ports, { wait: empty.wait, polls: 3 });
    assert.equal(outcome.kind, 'empty');
    assert.deepEqual(empty.saved, [], 'an empty file was saved without being asked for');
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

  it('gives the room ten seconds before it offers the choice', () => {
    assert.equal(FETCH_STAND_MS, 10_000);
  });
});

describe('what the row says', () => {
  it('names the file while it waits, and names what opening it costs the room, once', () => {
    assert.equal(fetchingSentence('src/main.rs'), 'Fetching src/main.rs…');
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
