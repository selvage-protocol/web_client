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
  LEAVE_CANCEL_LABEL,
  LEAVE_HOST_LABEL,
  LEAVE_LABEL,
  LEAVE_TITLE,
  wireLeave,
} from '../src/browser/leave.ts';
import { LEFT_SESSION_SENTENCE } from '../src/browser/ended.ts';
import { forgetJoinUrl } from '../src/browser/share.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

/**
 * A control a test drives: the panel's own DOM, small enough to hold in the hand. Everything the
 * module touches is here — the panel's hidden flag, the question line, the two answers, focus, and
 * the document the outside-press watch hangs on.
 */
function control(hosting: boolean, options: { shortLabel?: () => boolean } = {}) {
  const seen: string[] = [];
  const outside: Array<(event: unknown) => void> = [];
  const make = (tag: string) => {
    const element = {
      tag,
      textContent: '',
      // Hidden to start, as the shell's own `#leave-confirm` is: a panel that begins visible cannot
      // fail the assertions that say a press raised it.
      hidden: true,
      focused: false,
      children: [] as unknown[],
      attributes: {} as Record<string, string>,
      listeners: {} as Record<string, Array<(event: unknown) => void>>,
      setAttribute: (name: string, value: string) => void (element.attributes[name] = value),
      getAttribute: (name: string) => element.attributes[name],
      contains: (node: unknown) => node === element || element.children.includes(node),
      appendChild: (node: unknown) => void element.children.push(node),
      focus: () => void (element.focused = true),
      addEventListener: (type: string, run: (event: unknown) => void) => {
        (element.listeners[type] ??= []).push(run);
      },
      removeEventListener: (type: string, run: (event: unknown) => void) => {
        element.listeners[type] = (element.listeners[type] ?? []).filter((known) => known !== run);
      },
      fire: (type: string, event: unknown = {}) => {
        for (const run of element.listeners[type] ?? []) run(event);
      },
      ownerDocument: {
        addEventListener: (type: string, run: (event: unknown) => void) => {
          if (type === 'pointerdown') outside.push(run);
        },
        removeEventListener: () => {},
      },
    };
    return element;
  };
  const panel = make('div');
  const question = make('p');
  const button = make('button');
  const cancel = make('button');
  const go = make('button');
  // The panel is what holds its own question and the two answers, which is what makes a press on
  // either of them a press inside the panel.
  panel.children.push(question, cancel, go);
  const leave = wireLeave({
    hosting: () => hosting,
    ...options,
    surface: {
      panel: panel as unknown as HTMLElement,
      question: question as unknown as HTMLElement,
      button: button as unknown as HTMLElement,
      cancel: cancel as unknown as HTMLButtonElement,
      go: go as unknown as HTMLButtonElement,
    },
    leave: () => void seen.push('left'),
  });
  return { panel, question, button, cancel, go, seen, outside, leave };
}

describe('the way out of a session', () => {
  it('tells a host what leaving costs before the press, not only in the question after it', () => {
    // The control said `Leave` for both roles, so a host learned that its press ends the room for
    // everyone in it only from the confirmation — one press too late, and in a `title` a phone
    // never shows. The role names the control as the seat is taken (`showRole`).
    const guest = control(false);
    guest.leave.showRole(false);
    assert.equal(guest.button.textContent, LEAVE_LABEL, 'a guest\u2019s way out lost its word');
    assert.equal(guest.button.attributes['aria-label'], LEAVE_TITLE, 'a guest\u2019s way out is unnamed');
    const host = control(true);
    host.leave.showRole(true);
    assert.equal(host.button.textContent, LEAVE_HOST_LABEL, 'a host\u2019s way out reads like a guest\u2019s');
    assert.equal(
      host.button.attributes['aria-label'],
      LEAVE_HOST_LABEL,
      'the name a screen reader reads is not the one on screen',
    );
    assert.equal(host.button.title, LEAVE_HOST_LABEL, 'the host\u2019s control explains nothing on hover');
    // And the role can change under it: a page that hosted and then joined says the guest's word.
    host.leave.showRole(false);
    assert.equal(host.button.textContent, LEAVE_LABEL, 'the control kept a role this window left');
  });

  it('says the host’s word in one word where the bar has no room for four', () => {
    // Measured at 390x844: `Leave and end the room` is 213 px of a 390 px bar, so the control took
    // a row of its own and the session bar was 138 px of the screen for the whole session. A phone
    // gets the verb and keeps the sentence: it is the accessible name, the tooltip, and the
    // question the press opens.
    const phone = control(true, { shortLabel: () => true });
    phone.leave.showRole(true);
    assert.equal(phone.button.textContent, LEAVE_LABEL, 'the phone bar carries four words again');
    assert.equal(
      phone.button.attributes['aria-label'],
      LEAVE_HOST_LABEL,
      'the phone’s control lost the consequence a screen reader reads',
    );
    assert.equal(phone.button.title, LEAVE_HOST_LABEL, 'the phone’s control explains nothing on hover');
    assert.equal(phone.question.textContent, HOST_LEAVE_QUESTION, 'the question lost what the press costs');
    // A pointer arriving mid-session gets the long verb back.
    const pointer = control(true, { shortLabel: () => false });
    pointer.leave.showRole(true);
    assert.equal(pointer.button.textContent, LEAVE_HOST_LABEL, 'a pointer’s bar lost the host’s word');
  });

  it('is a control in the chrome, named the way both desktop clients name it', () => {
    // `docs/studies/client-command-parity.md` §5, "Leave": `Leave the session`.
    assert.match(
      html,
      /<button id="leave" type="button" aria-label="Leave the session"[^>]*>Leave<\/button>/,
      'the chrome carries no leave control, or not in the clients’ own words',
    );
    // Its own border, and the destructive colour: the reviewer read the old borderless label as
    // text rather than as the way out, and for a host this press ends the room for everyone.
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.match(
      style,
      /#leave \{[^}]*border-color: var\(--border-strong\)[^}]*color: var\(--danger\)/,
      'the way out is still styled like a label',
    );
    assert.match(main, /getElementById\('leave'\)/, 'the page never reaches the control');
    assert.match(main, /leaveControl\.press\(\)/, 'the control is never pressed');
  });

  it('leaves at once for a guest, whose going costs nobody else anything', () => {
    const guest = control(false);
    guest.leave.press();
    assert.deepEqual(guest.seen, ['left'], 'a guest’s press asked a question');
    assert.equal(guest.panel.hidden, true, 'a guest’s press raised a panel');
    assert.equal(guest.button.textContent, '', 'the control’s own words changed');
  });

  it('asks a host first, in a panel anchored under the control that asked', () => {
    const host = control(true);
    host.leave.press();
    assert.deepEqual(host.seen, [], 'a host’s press ended the room without asking');
    assert.equal(host.panel.hidden, false, 'the question went nowhere a person can see');
    assert.equal(host.question.textContent, HOST_LEAVE_QUESTION, 'the panel asks something else');
    assert.equal(host.go.textContent, LEAVE_ASKING_LABEL, 'the destructive answer lost its words');
    assert.equal(host.cancel.textContent, LEAVE_CANCEL_LABEL, 'the quiet answer lost its words');
    // Focus lands on the answer that does not end the room: a stray Return is never the destructive
    // one, and a person reading the question is already in it.
    assert.equal(host.cancel.focused, true, 'focus did not land on Cancel');
    assert.equal(host.go.focused, false);
  });

  it('leaves on the answer that says so, and on nothing else', () => {
    const host = control(true);
    host.leave.press();
    assert.equal(host.button.attributes['aria-expanded'], 'true', 'the control does not say it is open');
    host.cancel.fire('click');
    assert.deepEqual(host.seen, [], 'Cancel left the room');
    assert.equal(host.panel.hidden, true, 'Cancel left the question up');
    assert.equal(
      host.button.attributes['aria-expanded'],
      'false',
      'the control still says it is open after Cancel',
    );
    assert.equal(host.button.focused, true, 'Cancel dropped focus on the floor');
    host.leave.press();
    host.go.fire('click');
    assert.deepEqual(host.seen, ['left'], 'the answer did not leave');
    assert.equal(host.panel.hidden, true, 'the panel outlived the answer');
  });

  it('takes the question away on Escape, and on a press anywhere else', () => {
    const host = control(true);
    host.leave.press();
    let prevented = 0;
    host.panel.fire('keydown', { key: 'Escape', preventDefault: () => void (prevented += 1) });
    assert.equal(prevented, 1, 'Escape was left to the browser');
    assert.equal(host.panel.hidden, true, 'Escape did not take the question away');
    assert.deepEqual(host.seen, [], 'Escape left the room');
    host.leave.press();
    host.outside[0]?.({ target: { tagName: 'DIV' } });
    assert.equal(host.panel.hidden, true, 'a press anywhere else left the question standing');
    // A press inside the panel, or on the control itself, is not a press anywhere else.
    host.leave.press();
    host.outside[0]?.({ target: host.go });
    assert.equal(host.panel.hidden, false, 'a press on the panel’s own answer dismissed it');
    host.outside[0]?.({ target: host.button });
    assert.equal(host.panel.hidden, false, 'a press on the control that asked dismissed it');
  });

  it('owns the panel state, so a room ending under it leaves the control at rest', () => {
    // The page calls `close` when the session ends: a question left open with its flag set would make
    // the next hosted session's first press do nothing visible.
    const host = control(true);
    host.leave.press();
    assert.equal(host.leave.asking(), true);
    host.leave.close();
    assert.equal(host.panel.hidden, true);
    assert.equal(host.button.attributes['aria-expanded'], 'false');
    assert.equal(host.leave.asking(), false);
    host.leave.press();
    assert.equal(host.panel.hidden, false, 'the next press raised nothing');
  });

  it('asks no timer: a slow reader’s answer is still there when they get to it', () => {
    // The earlier two-step morphed the control’s words and reverted them after six seconds, so a
    // person still reading the question pressed a button that had changed back under them.
    const host = control(true);
    host.leave.press();
    assert.equal(host.leave.asking(), true);
    host.leave.press();
    assert.equal(host.leave.asking(), false, 'a second press on the control left the question up');
    assert.deepEqual(host.seen, [], 'a second press on the control ended the room');
  });

  it('asks the question in the panel the page stands under the control', () => {
    assert.equal(
      HOST_LEAVE_QUESTION,
      'Leaving ends the room for everyone in it; the invite link stops working, and the last keystrokes may not reach your folder.',
    );
    assert.ok(
      !/nothing in it is saved/i.test(HOST_LEAVE_QUESTION),
      'the question still says nothing is saved, which the page just spent the session doing',
    );
    assert.match(HOST_LEAVE_QUESTION, /the invite link stops working/);
    assert.ok(!/\.\s/.test(HOST_LEAVE_QUESTION), 'the question grew into a paragraph');
    assert.match(main, /'leave-confirm'/, 'the question has no panel on the page');
    assert.match(main, /surface: \{/, 'the control is wired to no surface');
    // The control asks about the folder this window holds, not about the role the room has
    // not necessarily given it yet.
    assert.match(main, /hosting: \(\) => hostFolder !== undefined/, 'the page asks the wrong side');
    // The panel is anchored to the control, in the page’s own markup: the question and its two
    // answers are one glance apart.
    assert.match(
      html,
      /<div id="leave-wrap">[\s\S]*?<button id="leave"[\s\S]*?<div id="leave-confirm"[\s\S]*?id="leave-cancel"[\s\S]*?id="leave-anyway"/,
      'the question and its answers are not one unit under the control',
    );
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
