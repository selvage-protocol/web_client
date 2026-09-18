/**
 * The end of a session, and the two links that must read at a glance.
 *
 * Owner: "if the room is closed the instance should just disconnect with a
 * toast/popup similar to the joining one". So the page leaves the session —
 * socket disconnected, chrome gone, no half-dead roster, tree or link — and
 * says why on the card, with the paste box open for a fresh link. This
 * supersedes the resting terminal state: the stale tree, the dead roster and
 * the retired share link are deleted with it.
 *
 * Two clipping defects found in the served page:
 * 1. `#share` was 148 px wide against a 413 px value — the bar showed a prefix.
 * 2. the bare card's paste hint was 300 px wide in a 254 px field — clipped.
 *
 * Every check below failed before its change.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  REJOIN_PROMPT,
  SESSION_ENDED_MESSAGE,
  dropSession,
  roomGoneMessage,
  sessionOverMessage,
} from '../src/browser/ended.ts';
import { addressBarInvite, resolveJoin, showRejoinCard } from '../src/browser/join.ts';
import { displayShareLink, fitReadout } from '../src/browser/share.ts';

const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');
const ended = readFileSync(new URL('../src/browser/ended.ts', import.meta.url), 'utf8');
const shareBox = readFileSync(new URL('../src/browser/share-box.ts', import.meta.url), 'utf8');
const roster = readFileSync(new URL('../src/browser/roster.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const card = html.slice(html.indexOf('<div id="join">'), html.indexOf('id="workspace"'));

describe('the words for the end of a session', () => {
  it('names the room gone and the reason, in the desktop clients words', () => {
    assert.equal(roomGoneMessage('host did not return'), 'The room is gone (host did not return).');
    assert.equal(roomGoneMessage('  '), 'The room is gone (no reason given).');
    assert.equal(SESSION_ENDED_MESSAGE, 'The session ended.');
  });

  it('carries the one next step on the card that comes back', () => {
    assert.equal(REJOIN_PROMPT, 'Paste a fresh invite link to join another session.');
    assert.equal(
      sessionOverMessage(roomGoneMessage('host did not return')),
      'The room is gone (host did not return). Paste a fresh invite link to join another session.',
    );
    assert.equal(
      sessionOverMessage(SESSION_ENDED_MESSAGE),
      'The session ended. Paste a fresh invite link to join another session.',
    );
  });
});

describe('leaving the session', () => {
  it('drops the binding, the editor and the socket, in that order', () => {
    const order: string[] = [];
    dropSession({
      binding: { dispose: () => void order.push('binding') },
      editor: { dispose: () => void order.push('editor') },
      engine: { disconnect: () => void order.push('engine') },
    });
    assert.deepEqual(order, ['binding', 'editor', 'engine']);
  });

  it('drops the editor opener guard with the session', () => {
    const order: string[] = [];
    dropSession({
      linkGuard: { dispose: () => void order.push('linkGuard') },
      binding: { dispose: () => void order.push('binding') },
      editor: { dispose: () => void order.push('editor') },
      engine: { disconnect: () => void order.push('engine') },
    });
    assert.deepEqual(order, ['linkGuard', 'binding', 'editor', 'engine']);
  });

  it('the page holds the one guard registration per join, and drops it', () => {
    assert.match(main, /linkGuard = registerLinkGuard\(/, 'the page discards the registration');
    assert.match(main, /dropSession\(\{[^}]*linkGuard[^}]*\}\)/, 'the teardown never drops the guard');
    const refused = main.slice(main.indexOf('async function runJoin'), main.indexOf('async function join('));
    assert.match(refused, /linkGuard\?\.dispose\(\)/, 'a refused join left its guard registered');
  });

  it('a step that throws never strands the others, and never goes unsaid', () => {
    const order: string[] = [];
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args) => void logged.push(args);
    try {
      dropSession({
        binding: {
          dispose: () => {
            throw new Error('binding already gone');
          },
        },
        editor: { dispose: () => void order.push('editor') },
        engine: { disconnect: () => void order.push('engine') },
      });
    } finally {
      console.error = original;
    }
    assert.deepEqual(order, ['editor', 'engine'], 'a failed step stranded the rest of the teardown');
    assert.equal(logged.length, 1, 'the failed step was swallowed');
  });

  it('nothing live is nothing to drop', () => {
    dropSession({});
  });

  it('the page leaves on the room-gone notice, and on a terminal disconnect', () => {
    assert.match(
      main,
      /case 'roomGone':[\s\S]{0,80}?leaveSession\(roomGoneMessage\(notice\.reason\)\)/,
      'the room-gone notice never leaves the session',
    );
    assert.match(
      main,
      /case 'disconnected':[\s\S]{0,400}?leaveSession\(SESSION_ENDED_MESSAGE\)/,
      'a terminal disconnect never leaves the session',
    );
    assert.ok(main.includes('dropSession({'), 'the live session is never dropped');
  });

  it('takes the chrome with it instead of leaving it half dead', () => {
    for (const gone of [
      'sessionBar.hidden = true',
      'workspacePane.hidden = true',
      'editorHost.replaceChildren()',
    ]) {
      assert.ok(main.includes(gone), `the teardown never ${gone}`);
    }
  });

  it('the address bar stops being the way in once a room has closed', () => {
    const dead = new URLSearchParams('room=r-dead&token=t');
    assert.equal(addressBarInvite(true, dead).get('room'), 'r-dead', 'the sent link stopped winning');
    const afterClosing = addressBarInvite(false, dead);
    assert.equal(afterClosing.get('room'), null, 'the dead room still won the join');
    assert.deepEqual(
      resolveJoin(afterClosing, 'https://edit.example/?room=r-fresh&token=u', 'ws://127.0.0.1:9'),
      { base: 'ws://127.0.0.1:9', room: 'r-fresh', token: 'u' },
      'the fresh link pasted on the card did not land',
    );
  });

  it('leaves no trace of the resting terminal state', () => {
    for (const gone of [
      'endedMessage',
      'staleSnapshot',
      'visibleListing',
      'TREE_STALE_NOTE',
      'ROSTER_DISABLED_REASON',
      'SHARE_RETIRED_REASON',
      'retire(',
      'The room is closed',
    ]) {
      assert.ok(!main.includes(gone), `${gone} survives in the page`);
    }
    for (const gone of ['SHARE_RETIRED_REASON', 'ROSTER_DISABLED_REASON', 'TREE_STALE_NOTE', 'visibleListing']) {
      assert.ok(!ended.includes(gone), `${gone} still lives in ended.ts`);
    }
    assert.ok(!shareBox.includes('retire'), 'the share box can still retire a link');
    // The roster still draws disabled actions of its own — the self row's, and
    // a peer's Go to while they are in no document. They are reasoned, not
    // dead (test/roster.test.ts pins every one's title); what the terminal
    // state must not leave behind is its own dead-room vocabulary.
    assert.ok(!roster.includes('disabledReason'), 'the roster can still draw terminal reasons');
    assert.ok(!roster.includes('view.disabled'), 'the roster can still draw a dead-room flag');
    assert.ok(!style.includes('.retired'), 'the shell still styles a retired link');
  });
});

describe('the card the page comes back to', () => {
  function elements(over: Record<string, unknown> = {}) {
    return {
      join: { hidden: true },
      preview: { hidden: true },
      veil: { hidden: true },
      message: { hidden: true, textContent: '' },
      error: { textContent: 'stale failure' },
      inviteWrap: { hidden: true },
      inviteInput: { value: 'http://old/?room=r&token=t' },
      joinButton: { disabled: true, textContent: 'Joining…' },
      ...over,
    };
  }

  it('comes back over the preview, with the paste box open and the button ready', () => {
    const gone = 'The room is gone (host did not return). Paste a fresh invite link to join another session.';
    const elementsUnderTest = elements();
    showRejoinCard(elementsUnderTest, gone);
    assert.equal(elementsUnderTest.join.hidden, false, 'the card never came back');
    assert.equal(elementsUnderTest.preview.hidden, false, 'the blurred preview never came back');
    assert.equal(elementsUnderTest.veil.hidden, false, 'the veil never came back');
    assert.equal(elementsUnderTest.message.hidden, false, 'the reason never showed');
    assert.equal(elementsUnderTest.message.textContent, gone);
    assert.equal(elementsUnderTest.error.textContent, '', 'a stale failure stood on the card');
    assert.equal(elementsUnderTest.inviteWrap.hidden, false, 'the paste box stayed hidden in link mode');
    assert.equal(elementsUnderTest.inviteInput.value, '', 'the dead link stayed in the paste box');
    assert.equal(elementsUnderTest.joinButton.disabled, false, 'Join stayed disabled');
    assert.equal(elementsUnderTest.joinButton.textContent, 'Join', 'Join still read Joining…');
  });

  it('the shell carries and styles that line', () => {
    assert.match(card, /<p id="join-message" hidden><\/p>/, 'no message line on the card');
    assert.ok(style.includes('#join-message'), 'the message line is unstyled');
  });
});

describe('the share bar shows the link, not a prefix of it', () => {
  const TOKEN = '32dc6a91959c9d8a2d908167597248ea';

  it('drops the scheme and the host when the link is on this page', () => {
    assert.equal(
      displayShareLink(`http://127.0.0.1:8081/?room=r-0d9b7546196d&token=${TOKEN}`, 'http://127.0.0.1:8081'),
      '/?room=r-0d9b…6196d&token=32dc6a…248ea',
    );
  });

  it('keeps a shortened host when the link is somewhere else', () => {
    const shown = displayShareLink(
      'https://lumi-raspberrypi.muskellunge-yo.ts.net/?room=r-1&token=tok',
      'http://127.0.0.1:8081',
    );
    assert.ok(shown.startsWith('https://lumi-rasp'), `host lost: ${shown}`);
    assert.ok(!shown.includes('muskellunge-yo'), `host untruncated: ${shown}`);
  });

  it('leaves the link alone when there is no page to compare it against', () => {
    assert.equal(
      displayShareLink('https://edit.example/?room=r-1&token=tok'),
      'https://edit.example/?room=r-1&token=tok',
    );
  });

  it('is short enough for the pill to show whole', () => {
    const shown = displayShareLink(
      `http://127.0.0.1:8081/?room=r-0d9b7546196d&token=${TOKEN}`,
      'http://127.0.0.1:8081',
    );
    assert.ok(shown.length <= 44, `the bar's value is long enough to clip again: ${shown.length}`);
  });

  it('sizes the readout to the value it carries', () => {
    const readout = { size: 20 };
    fitReadout(readout, '/?room=r-0d9b…6196d&token=32dc6a…248ea');
    assert.ok(
      readout.size >= '/?room=r-0d9b…6196d&token=32dc6a…248ea'.length,
      'the readout is narrower than the value it shows',
    );
    assert.ok(readout.size <= 46, `the readout was padded past its value: ${readout.size}`);
    assert.ok(main.includes('fitReadout'), 'the bar leaves the readout at its intrinsic width');
  });
});

describe('the paste hint on the bare card', () => {
  it('is a schematic short enough for the field to show whole', () => {
    const hint = card.slice(card.indexOf('<input id="invite"')).match(/placeholder="([^"]*)"/)?.[1] ?? '';
    assert.match(hint, /\?room=…&token=…/, `no schematic: ${hint}`);
    assert.ok(hint.length <= 24, `the hint is long enough to clip again: ${hint} (${hint.length})`);
    assert.ok(!/ws:\/\//i.test(hint), `wire scheme in the hint: ${hint}`);
    assert.ok(!/token=[^…]/i.test(hint), `literal token material in the hint: ${hint}`);
    assert.ok(!/room=[^…]/i.test(hint), `literal room material in the hint: ${hint}`);
    assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(hint), `a bare address in the hint: ${hint}`);
  });

  it('is not rebuilt at runtime from the whole origin', () => {
    assert.ok(!main.includes('invitePlaceholder'), 'the card still builds a hint that clips');
  });
});
