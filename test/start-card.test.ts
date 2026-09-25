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

import { HOST_NEEDS_A_BROWSER } from '../src/browser/host.ts';
import {
  CARD_JOIN_CLASS,
  CARD_START_CLASS,
  cardIntentOf,
  clearNameFailure,
  initJoinCard,
  primaryActionOf,
  showJoinFailure,
  showNameFailure,
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
    assert.equal((html.match(/Start a Selvage session/g) ?? []).length, 1, 'the start heading is repeated');
    assert.equal((html.match(/Join a Selvage session/g) ?? []).length, 1, 'the join heading is repeated');
    // The card's only other brand was the small `svp` mark, so a guest could not tell what they
    // were joining; both headings name the product now.
    assert.match(html, /<h1 id="start-heading">Start a Selvage session<\/h1>/);
    assert.match(html, /<h1 id="join-heading" hidden>Join a Selvage session<\/h1>/);
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

  it('offers hosting as one quiet line, and says what it costs only on the start card', () => {
    // Both intents are offered it: the read `/meta` answers is not skipped because the address
    // carried a link, so a guest holding one can still start a room. On that card it is one quiet
    // line — design §7.1 — and the paragraph about whose tab this is belongs to the start card the
    // line opens, where the decision to host is actually made.
    const offering = sliceBetween(main, 'async function offerHosting', 'function pageBase');
    assert.ok(!/if \(linkIsTheInvite\)/.test(offering), 'the join card is offered no start action');
    assert.ok(offering.includes('hostWrap.hidden = false'), 'the start action is never revealed');
    assert.ok(!/scope/.test(offering), 'the offer is worded for a card it is not on');
    // The line is the guest's; the button keeps the join card's own leading rule.
    assert.match(html, /id="host-quiet"/, 'the guest card carries no quiet line');
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
    assert.ok(
      !new RegExp(`#join\\.${CARD_JOIN_CLASS} #host-quiet`).test(style),
      'the quiet line is dressed like the join card’s own action',
    );
  });
});

describe('the name error stands where the name was asked for', () => {
  it('the name refusal stands at the field, whichever action asked for it', () => {
    // The reviewer read this line under the button that was pressed, with focus still on the button
    // and the field unmarked, so it read as the button's own failure rather than the name's. Both
    // actions send the refusal to the field now.
    assert.match(
      main,
      /showNameFailure\(nameField, describe\(error\)\)/,
      'a refused name reaches no field',
    );
    assert.equal(
      (main.match(/showNameFailure\(nameField/g) ?? []).length,
      2,
      'one of the card\u2019s two actions still reports the name somewhere else',
    );
    // It clears the other line \u2014 one failure stands on the card at a time \u2014 and it writes no
    // failure of its own into either of them.
    const attempt = sliceBetween(main, 'async function attemptHost', 'async function offerHosting');
    assert.ok(
      !/joinError\.textContent = (?!'')/.test(attempt),
      'the start action still writes its failure into the join path\u2019s error line',
    );
    assert.match(
      attempt,
      /joinError\.textContent = ''/,
      'a stale failure under the invite path survives an attempt to start a room',
    );
    assert.match(
      attempt,
      /clearNameFailure\(nameField\)/,
      'a stale refusal of the name survives an attempt to start a room',
    );
    // The field's line is the field's: beside the box it is about, above the invite path, and
    // hidden while it is empty.
    const label = card.indexOf('<label>The name other participants see');
    const input = card.indexOf('id="name"');
    const error = card.indexOf('id="name-error"');
    const path = card.indexOf('id="invite-path"');
    assert.ok(label !== -1 && input !== -1 && error !== -1 && path !== -1, 'the card lost a part');
    assert.ok(label < input && input < error && error < path, 'the refusal is not beside the field');
    assert.match(card, /id="name-error" role="alert"/, 'the refusal line announces nothing');
    assert.match(
      card,
      /<input id="name"[^>]*aria-describedby="name-error"/,
      'the line a screen reader is told about is not associated with the field',
    );
    assert.match(rule('#name-error:empty'), /display:\s*none/, 'an empty refusal line holds a gap');
    assert.match(
      style,
      /#join input\[aria-invalid='true'\] \{[^}]*border-color:/,
      'an invalid field is not drawn as one',
    );
  });

  it('the field and the two buttons keep their own lines under their own controls', () => {
    // The folder and the socket failures have no field to stand at: they keep the button that asked.
    const attempt = sliceBetween(main, 'async function attemptHost', 'async function offerHosting');
    assert.match(
      attempt,
      /hostError\.textContent = picked\.sentence/,
      'a refused folder reaches no line under the button',
    );
    const wrap = sliceBetween(card, '<div id="host-wrap"', '</div>');
    const button = wrap.indexOf('id="host-button"');
    const error = wrap.indexOf('id="host-error"');
    const note = wrap.indexOf('id="host-note"');
    assert.ok(button !== -1 && error !== -1 && note !== -1, 'the start block lost a line');
    assert.ok(button < error && error < note, 'the failure does not stand under the button it belongs to');
    assert.match(wrap, /id="host-error" role="alert"/, 'the failure line announces nothing');
    assert.match(rule('#host-error:empty'), /display:\s*none/, 'an empty failure line holds a gap');
    // And the join path's own line, inside the reveal, under Join, keeps the invite failures.
    const inside = sliceBetween(card, '<details id="invite-path">', '</details>');
    const join = inside.indexOf('id="join-button"');
    const joinLine = inside.indexOf('id="join-error"');
    assert.ok(join !== -1 && joinLine !== -1 && join < joinLine, 'the join failure is not under Join');
    assert.match(inside, /id="join-error" role="alert"/, 'the join failure announces nothing');
  });

  it('the join path clears the field\u2019s refusal too, and writes no name failure of its own', () => {
    const attempt = sliceBetween(main, 'function attemptJoin', 'async function runJoin');
    assert.ok(
      !/hostError\.textContent = (?!'')/.test(attempt),
      'the join writes its failure into the start action\u2019s error line',
    );
    assert.match(
      attempt,
      /hostError\.textContent = ''/,
      'a stale failure under the start button survives an attempt to join',
    );
    assert.match(attempt, /clearNameFailure\(nameField\)/, 'a stale refusal of the name survives a join');
    assert.match(attempt, /joinError\.textContent = ''/, 'a stale invite refusal survives the next join');
    assert.match(
      attempt,
      /showNameFailure\(nameField, describe\(error\)\)/,
      'a refused name reaches no field on the join path',
    );
  });

  it('neither line is the other\u2019s: the three are separate elements', () => {
    assert.equal((html.match(/id="join-error"/g) ?? []).length, 1, 'the join error line is repeated');
    assert.equal((html.match(/id="host-error"/g) ?? []).length, 1, 'the start error line is repeated');
    assert.equal((html.match(/id="name-error"/g) ?? []).length, 1, 'the name error line is repeated');
  });
});

describe('the name field refuses for itself', () => {
  /** The field and its line, as small as `join.ts` touches them. */
  function fieldDouble() {
    const attributes: Record<string, string> = {};
    const field = {
      focused: 0,
      setAttribute: (name: string, value: string) => void (attributes[name] = value),
      removeAttribute: (name: string) => void delete attributes[name],
      focus: () => void (field.focused += 1),
    };
    return { field, attributes, error: { textContent: '' } };
  }

  it('writes at the field, marks it invalid and puts focus there', () => {
    // The three things the reviewer found missing when the sentence stood under the button:
    // the words beside the box, `aria-invalid` on it, and focus where the person has to type.
    const { field, attributes, error } = fieldDouble();
    showNameFailure({ field, error }, 'Type the name other participants will see.');
    assert.equal(error.textContent, 'Type the name other participants will see.');
    assert.equal(attributes['aria-invalid'], 'true', 'the field is not marked invalid');
    assert.equal(field.focused, 1, 'focus stayed on the button that was pressed');
    clearNameFailure({ field, error });
    assert.equal(error.textContent, '', 'the refusal outlives the value it was about');
    assert.equal(attributes['aria-invalid'], undefined, 'the field is still marked invalid');
  });
});

/**
 * The two states a bare page can be left in before anything the person does:
 * a card that cannot host a room here, and a join that was refused while the
 * invite path was shut. Both are about the same field's own action.
 */
describe('Enter and a refusal where the start card cannot host', () => {
  it('Enter in the name field runs the card\'s own action wherever the card cannot start a room', () => {
    // M3: on Firefox and Safari, on the page-only deploy and under `npm run serve`, this card
    // cannot start a room and the invite path is a shut disclosure — and Enter in the name field
    // did nothing at all: no line, no state change, no movement. The invite path is the only
    // action the page has left, so Enter takes it and the join path asks for the link it needs,
    // in its own line, under the button that asked. The reason hosting is not offered is already
    // standing beside it, in the card's own words (`#host-note`), so the answer is the action
    // and not a second copy of the sentence.
    assert.equal(primaryActionOf('start', false), 'join', 'Enter did nothing where the card cannot host');
    assert.equal(primaryActionOf('start', true), 'host', 'Enter stopped starting where the card can host');
    assert.equal(primaryActionOf('join', false), 'join', "Enter stopped joining a guest's page");

    const primary = sliceBetween(main, 'function runPrimary', 'hostButton.addEventListener');
    assert.match(
      primary,
      /primaryActionOf\(cardIntent, !hostButton\.hidden\)/,
      'Enter stopped reading whether the card offers to start a room',
    );
    assert.ok(primary.includes('attemptJoin()'), 'Enter with no room to start runs nothing at all');
    assert.ok(!/action === 'none'/.test(primary), 'Enter can still fall through to silence');
    // And the refusal is readable: the join opens the path it writes into.
    assert.match(primary, /attemptJoin\(\)[\s\S]*$/, 'the join is not what Enter runs');
  });

  it('the standing sentence that explains it is on the card, not only in the bundle', () => {
    // The action Enter takes is the join; why starting a room is not offered stands in
    // `#host-note`, above the button that would be there, and it is visible in every one of
    // these states.
    const offering = sliceBetween(main, 'async function offerHosting', 'function showHosting');
    assert.ok(offering.includes('showHosting('), 'the card is never told what to say about hosting');
    assert.match(
      main,
      /hostNote\.textContent = availability\.note/,
      'the note standing where the button would be is not written',
    );
    assert.match(
      HOST_NEEDS_A_BROWSER,
      /Joining a room here still works/,
      'the sentence for a browser that cannot host does not name the action that works',
    );
  });

  it('a join refusal opens the invite path it stands in, so it is always read', () => {
    // A bare page's early submit is replayed after the bundle lands with the
    // disclosure still shut; the refusal under Join would be written where nobody
    // can see it.
    const card = { invitePath: { open: false }, joinError: { textContent: '' } };
    showJoinFailure(card, 'Paste an invite link to join.');
    assert.equal(card.invitePath.open, true, 'the refusal was written inside a shut disclosure');
    assert.equal(card.joinError.textContent, 'Paste an invite link to join.');
  });

  it('both join refusals go through it, rather than writing the line straight in', () => {
    const preflight = sliceBetween(main, 'function attemptJoin', 'async function runJoin');
    const refused = sliceBetween(main, 'async function runJoin', '/** What the host button says');
    for (const [where, body] of [['the pre-flight', preflight], ['a refused join', refused]]) {
      assert.match(body, /showJoinFailure\(/, `${where} writes its refusal without opening the path`);
      assert.ok(
        !/joinError\.textContent = (?!'')/.test(body),
        `${where} still writes the refusal straight into the line`
      );
    }
  });
});
