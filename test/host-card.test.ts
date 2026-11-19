/**
 * The card's host action, which this page does not have.
 *
 * A browser tab cannot open a listening socket, so the relay runs in the host's own client: this
 * page joins the rooms an editor client or the MCP server hosts. Two things are pinned here. The
 * shell's markup: the host action is hidden, and it is a `type="button"`, so it can neither submit
 * the join form nor be armed by the pre-bundle hold that guards a submit. And the decision: the
 * card never offers the action, and it stands one sentence where the action would have been saying
 * why (`host.ts`, `docs/host-run-relay.md`).
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { HOST_RUNS_IN_A_CLIENT, hostAvailability } from '../src/browser/host.ts';

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

describe('the host action in the shell', () => {
  it('is hidden in the markup, so the first frame offers nothing that could only refuse', () => {
    const wrap = /<div id="host-wrap"([^>]*)>/.exec(html)?.[1] ?? '';
    assert.match(wrap, /\shidden/, `the host action paints before the bundle hides it: ${wrap}`);
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

  it('carries the refusal line and the sentence, and no offer of its own', () => {
    const wrap = sliceBetween(html, '<div id="host-wrap"', '</div>');
    const button = wrap.indexOf('id="host-button"');
    const error = wrap.indexOf('id="host-error"');
    const note = wrap.indexOf('id="host-note"');
    assert.ok(button !== -1 && error !== -1 && note !== -1, 'the host block lost a line');
    assert.ok(button < error && error < note, 'the lines stand in an order that says nothing');
    assert.match(wrap, /id="host-error" role="alert"/, 'the refusal line announces nothing');
    // The guest card's quiet invitation to start a room was the other half of the offer, and the
    // relay is not the page's: it is gone from the shell and from the bundle.
    assert.ok(!html.includes('host-quiet'), 'the guest card still offers to start a session');
    assert.ok(!main.includes('hostQuiet'), 'the bundle still wires the quiet offer');
    assert.ok(!main.includes('swapCardToStart'), 'the bundle still swaps to a start card');
    assert.ok(!html.includes('Choose a folder'), 'the long folder label survives in the shell');
  });
});

describe('whether the card offers to start a room', () => {
  it('never does: it says where the relay runs instead', () => {
    const availability = hostAvailability();
    assert.equal(availability.kind, 'explained');
    assert.equal(availability.note, HOST_RUNS_IN_A_CLIENT);
    // The sentence has to name the act a person can take, and the case it cannot take here.
    assert.match(HOST_RUNS_IN_A_CLIENT, /A browser tab cannot run a room’s relay/);
    assert.match(HOST_RUNS_IN_A_CLIENT, /editor client or the MCP server/);
    assert.match(HOST_RUNS_IN_A_CLIENT, /open the invite here/);
    assert.ok(!/directory picker|showDirectoryPicker|Chrome and Edge|Firefox/.test(HOST_RUNS_IN_A_CLIENT),
      `the sentence is about a browser that cannot pick a folder: ${HOST_RUNS_IN_A_CLIENT}`);
  });
});

describe('what the card is told', () => {
  it('puts the sentence where the action would be, and never reveals the action', () => {
    const showing = sliceBetween(main, 'function showHosting', 'function pageBase');
    assert.match(showing, /hostButton\.hidden = true/, 'the start action is still revealed');
    assert.match(showing, /hostNote\.textContent = note/, 'the sentence is not what the card is told');
    assert.match(showing, /hostWrap\.hidden = false/, 'the sentence has no room to stand in');
    // A guest came to join, and a refusal there would be about an action this card never offered
    // them: the sentence stands only where the action would have been.
    assert.match(showing, /if \(cardIntent === 'join'\)/, 'the two intents are told the same thing');
    assert.match(showing, /hostWrap\.hidden = true/, 'a guest is read about hosting');
    assert.match(showing, /hostNote\.textContent = ''/, 'the guest card still writes a note');
    // And the way in the card does have leads: the invite path opens and Join takes the action.
    assert.match(showing, /joinPane\.classList\.add\('no-host'\)/, 'Join does not lead the card');
    assert.match(showing, /invitePath\.open = true/, 'the invite path a person needs stays shut');
  });

  it('refuses a call that reaches the host action anyway, in the same words', () => {
    const attempt = sliceBetween(main, 'function attemptHost', 'function showHosting');
    assert.match(
      attempt,
      /hostError\.textContent = HOST_RUNS_IN_A_CLIENT/,
      'a call to host answers with something other than the card’s sentence',
    );
    // The card is told at load, and nowhere later: the answer never changes.
    assert.match(main, /^showHosting\(\);$/m, 'the card is never told what it offers');
  });

  it('asks no `/meta` and looks for no directory picker', () => {
    // The offer used to rest on this page's own origin and on a folder picker. Neither is a fact
    // about hosting any more: the relay is the host client's, so nothing here reads or picks.
    assert.ok(!/readServerMeta|META_REREAD_TIMEOUT_MS/.test(main), 'the card reads /meta for nothing');
    assert.ok(!/pickFolder|folderPickerOf/.test(main), 'the card looks for a directory picker');
    assert.ok(!/offerHosting/.test(main), 'the card still offers hosting on a read');
    assert.ok(!/markHosting|takeHostingNotice/.test(main), 'the page still marks a hosted tab');
  });
});
