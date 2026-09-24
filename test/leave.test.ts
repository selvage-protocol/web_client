/**
 * Leaving a session: the control, the host's question, and the address bar.
 *
 * Review finding. There was no way out of a session but closing the tab: the
 * page's teardown (`leaveSession`) ran only when the room ended under it, so a
 * guest who wanted out had to lose the page, and a host had no way to say it was
 * done that was different from crashing.
 *
 * A host's leaving is not the same act as a guest's. The room's state is signed
 * by the host key and the room is destroyed `room_grace_ms` after its **last**
 * connection ends (`PROTOCOL.md` §9), while everyone still in it goes on editing
 * until their own host-away clock passes `awareness_expire_ms` and their sessions
 * end (`§13.8`). So a host's Leave asks before it acts.
 *
 * The page cannot be driven here — `main.ts` is the entry module — so the
 * two-step is `src/browser/leave.ts`, the address-bar rule is `forgetJoinUrl`,
 * and the page's own wiring is pinned by source, the way the reconnecting line
 * is (`test/join-chrome.test.ts`, `scripts/prove-flow2.mjs`).
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HOST_LEAVE_QUESTION,
  LEAVE_ASKING_LABEL,
  LEAVE_ASK_MS,
  LEAVE_LABEL,
  wireLeave,
} from '../src/browser/leave.ts';
import { LEFT_SESSION_SENTENCE } from '../src/browser/ended.ts';
import { forgetJoinUrl } from '../src/browser/share.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

/** A control a test drives: the button's words, what was asked, and what was done. */
function control(hosting: boolean) {
  const timer: Array<() => void> = [];
  const seen: string[] = [];
  const button = { textContent: LEAVE_LABEL };
  const leave = wireLeave({
    hosting: () => hosting,
    button,
    ask: () => void seen.push('asked'),
    leave: () => void seen.push('left'),
    schedule: (run) => void timer.push(run),
    cancel: () => {},
  });
  return { button, seen, timer, leave };
}

describe('the way out of a session', () => {
  it('is a control in the chrome, named the way both desktop clients name it', () => {
    // `docs/studies/client-command-parity.md` §5, "Leave": `Leave the session`.
    assert.match(
      html,
      /<button id="leave" type="button" aria-label="Leave the session"\s*\n?\s*title="Leave the session">Leave<\/button>/,
      'the chrome carries no leave control, or not in the clients’ own words',
    );
    assert.match(main, /getElementById\('leave'\)/, 'the page never reaches the control');
    assert.match(main, /leaveControl\.press\(\)/, 'the control is never pressed');
  });

  it('leaves at once for a guest, whose going costs nobody else anything', () => {
    const guest = control(false);
    guest.leave.press();
    assert.deepEqual(guest.seen, ['left'], 'a guest’s press asked a question');
    assert.equal(guest.button.textContent, LEAVE_LABEL);
    assert.equal(guest.timer.length, 0, 'a guest’s press armed an ask');
  });

  it('asks a host first, and leaves on the press that answers', () => {
    const host = control(true);
    host.leave.press();
    assert.deepEqual(host.seen, ['asked'], 'a host’s press ended the room without asking');
    assert.equal(host.button.textContent, LEAVE_ASKING_LABEL, 'the control does not ask the question');
    assert.equal(host.timer.length, 1, 'the ask stands for ever');
    host.leave.press();
    assert.deepEqual(host.seen, ['asked', 'left'], 'the answer did not leave');
    assert.equal(host.button.textContent, LEAVE_LABEL, 'the control kept the answered words');
  });

  it('takes the ask back when it goes unanswered', () => {
    const host = control(true);
    host.leave.press();
    host.timer[0]?.();
    assert.deepEqual(host.seen, ['asked'], 'an expired ask left the session');
    assert.equal(host.button.textContent, LEAVE_LABEL, 'the ask stayed on the control for ever');
    host.leave.press();
    assert.deepEqual(host.seen, ['asked', 'asked'], 'the ask could not be raised again');
  });

  it('names what leaving costs, in the strip the page already keeps for the room', () => {
    assert.equal(
      HOST_LEAVE_QUESTION,
      'Leaving ends the room for everyone in it, and nothing in it is saved.',
    );
    assert.ok(LEAVE_ASK_MS >= 4000, 'the question is gone before it can be read');
    assert.match(
      main,
      /ask: \(\) => sessionNote\.say\(HOST_LEAVE_QUESTION, LEAVE_ASK_MS\)/,
      'the question has no home on the page',
    );
    // The control asks about the folder this window holds, not about the role the room has
    // not necessarily given it yet.
    assert.match(main, /hosting: \(\) => hostFolder !== undefined/, 'the page asks the wrong side');
  });

  it('ends the session in the desktop clients’ words, with the card’s own next step', () => {
    assert.equal(LEFT_SESSION_SENTENCE, 'Left the session.');
    assert.match(
      main,
      /leave: \(\) => leaveSession\(LEFT_SESSION_SENTENCE\)/,
      'a leave reaches no teardown',
    );
  });
});

describe('the address bar after a leave', () => {
  it('keeps the page and drops the room, its token and its keys', () => {
    const calls: unknown[][] = [];
    forgetJoinUrl(
      { replaceState: (...args: unknown[]) => void calls.push(args) },
      'https://edit.example/?room=r-1&token=tok#k=key&h=host',
    );
    assert.deepEqual(calls, [[null, '', '/']], 'the link the room was joined by stays in the bar');
  });

  it('leaves a page with nothing of the room in its address alone', () => {
    const calls: unknown[][] = [];
    forgetJoinUrl(
      { replaceState: (...args: unknown[]) => void calls.push(args) },
      'https://edit.example/index.html',
    );
    assert.deepEqual(calls, [], 'an untouched address bar was rewritten');
  });

  it('survives a history that refuses the write, which a `file://` page has', () => {
    assert.doesNotThrow(() =>
      forgetJoinUrl(
        {
          replaceState: () => {
            throw new Error('The operation is insecure.');
          },
        },
        'file:///home/me/index.html?room=r-1&token=tok',
      ),
    );
  });

  it('runs in the page’s own teardown, so every leave takes the link with it', () => {
    const teardown = /function leaveSession\(sentence: string\)[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
    assert.ok(teardown !== '', 'the page has no teardown to read');
    assert.match(
      teardown,
      /forgetJoinUrl\(window\.history, window\.location\.href\)/,
      'a page that left the room still carries its way back in',
    );
  });
});
