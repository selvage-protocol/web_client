/**
 * The card's two intents, and which one a person arrives at.
 *
 * Owner defect (2026-09-23): a page opened with no invite was titled *Join a
 * shared session*, asked for the name inside its join form, and put *Start a
 * session here* under a rule — so pressing that with the name empty produced
 * "Type the name other participants will see.", which read as the join form's
 * error and left the person unsure whether they needed a link, a name, or both.
 * The owner's own words: "it should just be insert name -> start a session".
 *
 * So the card is a start card on a bare open: its own heading, the name, and one
 * primary button that starts a room here, with the invite path a disclosure under
 * it. An invite in the address is the guest's card: the room is known, the name
 * is asked, and Join leads — the start action stays, quiet, under it.
 *
 * These are the wiring's decisions, driven through structural doubles the way
 * the rest of this suite drives them (`test/join-card-init.test.ts`); the shell
 * markup they take over from, and the stylesheet that decides which action leads,
 * are read as text.
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_JOIN_CLASS,
  CARD_START_CLASS,
  cardIntentOf,
  initJoinCard,
} from '../src/browser/join.ts';
import type { JoinCardElements } from '../src/browser/join.ts';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const card = html.slice(html.indexOf('<div id="join"'), html.indexOf('id="workspace"'));
const main = readFileSync(new URL('../src/browser/main.ts', import.meta.url), 'utf8');

/** The card's live controls, as the bundle wires them onto the shell. */
function elements(over: Partial<JoinCardElements> = {}): JoinCardElements {
  return {
    pane: { className: '' },
    startHeading: { hidden: false },
    joinHeading: { hidden: false },
    invitePath: { open: false },
    inviteReveal: { hidden: false },
    inviteWrap: { hidden: false },
    inviteInput: { value: '' },
    nameInput: { value: '' },
    ...over,
  };
}

const emptyStorage: Pick<Storage, 'getItem'> = { getItem: () => null };

/** What carries the primary look, and what stands down for it, in one card state. */
function rule(selector: string): string {
  const found = style.match(new RegExp(`${selector.replace(/[.#]/g, '\\$&')}\\s*\\{[^}]*\\}`));
  assert.ok(found !== null, `no ${selector} rule in the shell`);
  return found[0];
}

function sliceBetween(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  assert.ok(start !== -1, `no ${from} in the shell`);
  const end = text.indexOf(to, start);
  assert.ok(end !== -1, `no ${to} after ${from} in the shell`);
  return text.slice(start, end);
}

describe('what the address bar makes the card', () => {
  it('a room and its token are the invite; anything short of both is a bare page', () => {
    assert.equal(cardIntentOf(new URLSearchParams('room=r-1&token=tok')), 'join');
    assert.equal(cardIntentOf(new URLSearchParams('debug=1&room=r-1&token=tok')), 'join');
    assert.equal(cardIntentOf(new URLSearchParams('room=%20r-1%20&token=tok')), 'join');
    for (const bare of ['', 'room=r-1', 'token=tok', 'room=&token=', 'room=%20&token=tok', 'debug=1']) {
      assert.equal(cardIntentOf(new URLSearchParams(bare)), 'start', bare);
    }
  });

  it('each intent has its own sentence, and each sentence has one home', () => {
    assert.equal((html.match(/Start a shared session/g) ?? []).length, 1, 'the start heading is repeated');
    assert.equal((html.match(/Join a shared session/g) ?? []).length, 1, 'the join heading is repeated');
  });
});

describe('the start card: what a person with no invite reads first', () => {
  it('the shell paints it before any script: the start heading, and the join heading hidden', () => {
    const opening = /<div id="join"([^>]*)>/.exec(html)?.[1] ?? '';
    assert.match(opening, /class="card-start"/, `the card is not the start card to begin with: ${opening}`);
    const start = /<h1 id="start-heading"([^>]*)>/.exec(html)?.[1] ?? '';
    assert.ok(!/\shidden/.test(start), `the start heading is hidden in the markup: ${start}`);
    const join = /<h1 id="join-heading"([^>]*)>/.exec(html)?.[1] ?? '';
    assert.match(join, /\shidden/, `the join heading paints before the address bar is read: ${join}`);
  });

  it('leads with the name and the start button, not with a link it asks for', () => {
    const wired = elements();
    const intent = initJoinCard(wired, new URLSearchParams(), emptyStorage);
    assert.equal(intent, 'start');
    assert.equal(wired.pane.className, CARD_START_CLASS);
    assert.equal(wired.startHeading.hidden, false, 'the start heading is not read');
    assert.equal(wired.joinHeading.hidden, true, 'the join heading is read on a bare page');
    assert.equal(wired.invitePath.open, false, 'a bare page asks for a link before the name');
    assert.equal(wired.inviteReveal.hidden, false, 'nothing offers the person a link to paste');

    // The name is the card's own question and the start button is the action beside
    // it: both in the card, the field first, and the action outside the join form so
    // that pressing it can never submit a join the person did not ask for.
    const name = html.indexOf('id="name"');
    const host = html.indexOf('id="host-wrap"');
    assert.ok(name !== -1 && host !== -1, 'the card lost its name field or its start action');
    assert.ok(name < host, 'the start action is asked for before the name it needs');
    assert.ok(card.includes('id="name"') && card.includes('id="host-wrap"'), 'a part of the card left it');
    const form = sliceBetween(card, '<form id="join-form"', '</form>');
    assert.ok(!form.includes('host-button'), 'a start click would submit the join form');
    const button = /<button id="host-button"([^>]*)>/.exec(html)?.[1] ?? '';
    assert.match(button, /type="button"/, `the start action is a submit button: ${button}`);
  });

  it('gives the start action the primary look, and the join under it the quiet one', () => {
    assert.match(
      rule(`#join.${CARD_START_CLASS} #host-button`),
      /background:\s*var\(--primary\)/,
      'the start action does not lead the start card',
    );
    assert.match(
      rule(`#join.${CARD_START_CLASS} #join-button`),
      /background:\s*var\(--muted\)/,
      'the join still leads the start card',
    );
  });
});

describe('the invite path: the disclosure a person with a link opens', () => {
  it('is the browser\'s own disclosure, shut on arrival, with the paste box inside it', () => {
    const details = /<details id="invite-path"([^>]*)>/.exec(html);
    assert.ok(details !== null, 'the invite path is not a disclosure');
    assert.ok(!/\sopen/.test(details[1] ?? ''), `the invite path opens itself: ${details[1]}`);
    assert.match(
      html,
      /<summary id="invite-reveal">Have an invite link\?<\/summary>/,
      'the disclosure asks nothing a person would answer',
    );
    const inside = sliceBetween(card, '<details id="invite-path">', '</details>');
    assert.ok(inside.includes('id="invite-wrap"'), 'the paste box is not what the disclosure reveals');
    assert.ok(inside.includes('id="invite"'), 'no paste field behind the disclosure');
    assert.ok(inside.includes('id="join-button"'), 'no join button behind the disclosure');
    assert.match(
      inside,
      /id="join-button"[^>]*type="submit"|type="submit"[^>]*id="join-button"/,
      'Join is not the form\'s submit button: Enter in the paste box would not join',
    );
    // A bare open leaves the box where the disclosure can show it: the wiring hides
    // the box only when the room is already named by the address.
    const wired = elements();
    initJoinCard(wired, new URLSearchParams(), emptyStorage);
    assert.equal(wired.inviteWrap.hidden, false, 'opening the disclosure would reveal nothing');
  });

  it('asks the person, rather than the bundle, to open it', () => {
    // Nothing in the bundle has to open it: the paste box and Join are inside the
    // element the browser opens, so the path works in the window before any script
    // arrives — which is the whole reason it is a `<details>`.
    assert.ok(
      !/invitePath\.addEventListener|invite-path'\)\.addEventListener/.test(main),
      'the disclosure needs the bundle to be opened',
    );
    assert.match(html, /details id="invite-path"/, 'the disclosure left the shell');
  });
});

describe('the join card: what a person who followed a link reads', () => {
  it('asks the name and joins the room the address names', () => {
    const wired = elements();
    const intent = initJoinCard(wired, new URLSearchParams('room=r-1&token=tok'), emptyStorage);
    assert.equal(intent, 'join');
    assert.equal(wired.pane.className, CARD_JOIN_CLASS);
    assert.equal(wired.joinHeading.hidden, false, 'the join heading is not read');
    assert.equal(wired.startHeading.hidden, true, 'the start heading leads a guest\'s page');
    assert.equal(wired.invitePath.open, true, 'the join path is shut on a page an invite named');
    assert.equal(wired.inviteReveal.hidden, true, 'a page with a link asks whether it has one');
    assert.equal(wired.inviteWrap.hidden, true, 'the guest is asked to paste the link they followed');
  });

  it('keeps the start action, secondary, and offers it on both intents', () => {
    // Both intents are offered it: the read `/meta` answers is not skipped because
    // the address carried a link, so a guest holding one can still start a room.
    const offering = sliceBetween(main, 'async function offerHosting', 'function pageBase');
    assert.ok(!/if \(linkIsTheInvite\)/.test(offering), 'the join card is offered no start action');
    assert.ok(offering.includes('hostWrap.hidden = false'), 'the start action is never revealed');
    // And it is the quiet one there: the join button keeps the rule that carries the
    // primary look, and the start button is left with the page's own plain button.
    assert.match(rule('#join-button'), /margin-top/, 'the join button lost its own rule');
    assert.match(
      html,
      /<button id="join-button" class="primary" type="submit">Join<\/button>/,
      'Join is not the button the join card leads with',
    );
    assert.ok(
      !new RegExp(`#join\\.${CARD_JOIN_CLASS} #host-button`).test(style),
      'the join card dresses the start action like its own',
    );
  });
});

describe('the name error stands where the name was asked for', () => {
  it('the start action reports into its own line, beside its own button', () => {
    const attempt = sliceBetween(main, 'async function attemptHost', 'async function offerHosting');
    assert.ok(
      attempt.includes('hostError.textContent = describe(error)'),
      'a refused name does not reach the line under the start button',
    );
    // It clears the other line — one failure stands on the card at a time — and it never
    // writes a failure of its own into it.
    assert.ok(
      !/joinError\.textContent = (?!'')/.test(attempt),
      'the start action still writes its failure into the join path\'s error line',
    );
    assert.match(
      attempt,
      /joinError\.textContent = ''/,
      'a stale failure under the invite path survives an attempt to start a room',
    );
    // The line is inside the start action's own block, under the button and above the
    // standing warning: it moves with the action, and it is hidden while it is empty.
    const wrap = sliceBetween(card, '<div id="host-wrap"', '</div>');
    const button = wrap.indexOf('id="host-button"');
    const error = wrap.indexOf('id="host-error"');
    const note = wrap.indexOf('id="host-note"');
    assert.ok(button !== -1 && error !== -1 && note !== -1, 'the start block lost a line');
    assert.ok(button < error && error < note, 'the failure does not stand under the button it belongs to');
    assert.match(wrap, /id="host-error" role="alert"/, 'the failure line announces nothing');
    assert.match(rule('#host-error:empty'), /display:\s*none/, 'an empty failure line holds a gap');
  });

  it('the join path keeps its own, inside the reveal, under Join', () => {
    const inside = sliceBetween(card, '<details id="invite-path">', '</details>');
    const join = inside.indexOf('id="join-button"');
    const error = inside.indexOf('id="join-error"');
    assert.ok(join !== -1 && error !== -1 && join < error, 'the join failure is not under Join');
    assert.match(inside, /id="join-error" role="alert"/, 'the join failure announces nothing');
    const attempt = sliceBetween(main, 'function attemptJoin', 'async function runJoin');
    assert.ok(
      !/hostError\.textContent = (?!'')/.test(attempt),
      'the join writes its failure into the start action\'s error line',
    );
    assert.match(
      attempt,
      /hostError\.textContent = ''/,
      'a stale failure under the start button survives an attempt to join',
    );
  });

  it('neither line is the other\'s: the two are separate elements', () => {
    assert.equal((html.match(/id="join-error"/g) ?? []).length, 1, 'the join error line is repeated');
    assert.equal((html.match(/id="host-error"/g) ?? []).length, 1, 'the start error line is repeated');
  });
});
